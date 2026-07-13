import * as fs from "node:fs";
import * as path from "node:path";
import { generateConfigToml } from "../configToml";
import { detectHarnesses } from "../detect";
import { usageError } from "../errors";
import { buildLock, lockPath, serializeLock } from "../lock";
import { mergeClaudeSettings, mergeCodexHooks } from "../merge";
import {
  CORE_SRC,
  PACKS_ROOT,
  SHIMS_ROOT,
  configTomlPath,
  engineDestDir,
  packsDestDir,
  readCliVersion,
  tenetsDir,
} from "../paths";
import { listPacks } from "../packYaml";
import type { PackMeta, WriteResult } from "../types";
import { isInteractive, promptMultiselect } from "../ui";
import { looksLikeTestFile, vendorDir, vendorInto, writeIfChanged } from "../vendor";

export interface InitOptions {
  /** Raw `--packs` value: "all" or a comma-separated id list. */
  packsFlag?: string;
  yes: boolean;
}

export interface InitOutcome {
  changed: boolean;
  lines: string[];
}

async function resolvePackSelection(opts: InitOptions, available: PackMeta[]): Promise<string[]> {
  if (opts.packsFlag !== undefined) {
    if (opts.packsFlag === "all") return available.map((p) => p.id);
    const requested = opts.packsFlag
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (requested.length === 0) {
      usageError('`--packs` requires at least one pack id, or "all".');
    }
    const availableIds = new Set(available.map((p) => p.id));
    const unknown = requested.filter((id) => !availableIds.has(id));
    if (unknown.length > 0) {
      usageError(`Unknown pack id(s): ${unknown.join(", ")}. Available: ${available.map((p) => p.id).join(", ")}`);
    }
    return requested;
  }
  if (opts.yes) {
    return available.map((p) => p.id);
  }
  if (isInteractive()) {
    return promptMultiselect(
      available.map((p) => ({ id: p.id, label: p.title })),
      "Select rule packs to install:",
    );
  }
  usageError("Pack selection is required in non-interactive mode: pass --packs <ids|all> or -y.");
}

function reportResult(label: string, result: WriteResult): string {
  return `  ${result === "unchanged" ? "unchanged" : result.padEnd(9)} ${label}`;
}

/** Finds the shim's entrypoint file for wiring purposes. Prefers `entry.py`/
 * `entry.js` (a convention this CLI assumes, mirroring core's own
 * `events/*.py` naming); otherwise the first non-test-shaped top-level file,
 * sorted, so wiring is deterministic. Excluding test-shaped names matters in
 * practice: the codex shim ships `claude_compat.py` alongside
 * `test_claude_compat.py` in the same flat directory. Falls back to any file
 * at all (even test-shaped) rather than throwing, as a last resort. */
function findShimEntrypoint(shimDestDir: string): string {
  for (const candidate of ["entry.py", "entry.js"]) {
    if (fs.existsSync(path.join(shimDestDir, candidate))) return path.join(shimDestDir, candidate);
  }
  const allFiles = fs
    .readdirSync(shimDestDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
  const nonTest = allFiles.filter((name) => !looksLikeTestFile(name));
  const chosen = nonTest[0] ?? allFiles[0];
  return chosen ? path.join(shimDestDir, chosen) : shimDestDir;
}

export async function runInit(root: string, opts: InitOptions): Promise<InitOutcome> {
  const lines: string[] = [];
  let anyChange = false;
  const note = (line: string) => lines.push(line);
  const markChanged = (result: WriteResult) => {
    if (result !== "unchanged") anyChange = true;
  };

  const detections = detectHarnesses(root);
  note("Detected harnesses:");
  for (const d of detections) {
    note(`  ${d.harness.padEnd(9)} ${d.detected ? `yes (${d.signals.join(", ")})` : "no"}`);
  }
  note("");

  const available = listPacks(PACKS_ROOT);
  if (available.length === 0) {
    usageError(`No packs found under ${PACKS_ROOT}.`);
  }

  const selectedIds = await resolvePackSelection(opts, available);
  const selectedPacks = selectedIds
    .map((id) => available.find((p) => p.id === id))
    .filter((p): p is PackMeta => Boolean(p));

  const lockFiles: Record<string, string> = {};

  note(`Packs (${selectedPacks.length}):`);
  for (const pack of selectedPacks) {
    const dest = packsDestDir(root, pack.id);
    const results = vendorDir(pack.dir, dest);
    for (const r of results) {
      lockFiles[`packs/${pack.id}/${r.relPath}`] = r.hash;
      markChanged(r.result);
    }
    note(`  ${pack.id} -> .tenets/packs/${pack.id}/ (${results.length} files)`);
  }

  const engineResults = vendorDir(CORE_SRC, engineDestDir(root));
  for (const r of engineResults) {
    lockFiles[`engine/${r.relPath}`] = r.hash;
    markChanged(r.result);
  }
  note(`Engine vendored -> .tenets/engine/ (${engineResults.length} files)`);

  // Codex: only wired when packages/shims/codex exists in source at the
  // moment init runs (checked fresh every run, never hardcoded — see
  // repo-structure.md's F1/decision-7 and merge.ts's doc comment).
  const codexShimSrc = path.join(SHIMS_ROOT, "codex");
  if (fs.existsSync(codexShimSrc)) {
    const codexDest = path.join(engineDestDir(root), "shims", "codex");
    const shimResults = vendorInto(codexShimSrc, codexDest);
    for (const r of shimResults) {
      lockFiles[`engine/shims/codex/${r.relPath}`] = r.hash;
      markChanged(r.result);
    }
    const entrypoint = findShimEntrypoint(codexDest);
    const relEntry = path.relative(root, entrypoint);
    const hooksPath = path.join(root, ".codex", "hooks.json");
    const existing = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, "utf8") : null;
    let merged;
    try {
      merged = mergeCodexHooks(existing, relEntry);
    } catch (err) {
      throw new Error(`.codex/hooks.json exists but is not valid JSON: ${(err as Error).message}`);
    }
    const result = writeIfChanged(hooksPath, merged.text);
    markChanged(result);
    note(`Codex wired -> .codex/hooks.json (${merged.changed ? "added hook" : "already wired"})`);
  } else {
    note("codex: engine shim not present in source, skipped");
  }

  // OpenCode: same "check source fresh every run" discipline as Codex.
  // Test-shaped files (e.g. smoke-test.js) are excluded: OpenCode scans its
  // whole plugins/ directory, so a stray dev-test script vendored in there
  // would be loaded as a plugin too, unlike Codex (which references one
  // specific file path and is unaffected by extra files sitting alongside it).
  const opencodeShimSrc = path.join(SHIMS_ROOT, "opencode");
  if (fs.existsSync(opencodeShimSrc)) {
    const opencodeDest = path.join(root, ".opencode", "plugins");
    const results = vendorInto(opencodeShimSrc, opencodeDest, { exclude: looksLikeTestFile });
    for (const r of results) markChanged(r.result);
    note(`OpenCode plugin vendored -> .opencode/plugins/ (${results.length} files)`);
  } else {
    note("opencode: engine plugin not present in source, skipped");
  }

  const languages = selectedPacks.length > 0 ? ["kotlin"] : [];
  const configText = generateConfigToml({
    languages,
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: selectedPacks,
  });
  const configResult = writeIfChanged(configTomlPath(root), configText);
  markChanged(configResult);
  note(reportResult(".tenets/config.toml", configResult));

  const lock = buildLock(`portable-hooks@${readCliVersion()}`, lockFiles);
  const lockResult = writeIfChanged(lockPath(tenetsDir(root)), serializeLock(lock));
  markChanged(lockResult);
  note(reportResult(`.tenets/lock.json (${Object.keys(lockFiles).length} files)`, lockResult));

  const claudeSettingsPath = path.join(root, ".claude", "settings.json");
  const existingClaudeText = fs.existsSync(claudeSettingsPath) ? fs.readFileSync(claudeSettingsPath, "utf8") : null;
  let claudeMerge;
  try {
    claudeMerge = mergeClaudeSettings(existingClaudeText);
  } catch (err) {
    throw new Error(`.claude/settings.json exists but is not valid JSON: ${(err as Error).message}`);
  }
  const claudeResult = writeIfChanged(claudeSettingsPath, claudeMerge.text);
  markChanged(claudeResult);
  note(`Claude Code wired -> .claude/settings.json (${claudeMerge.changed ? "added hook" : "already wired"})`);

  note("");
  note(anyChange ? "portable-hooks: init complete." : "portable-hooks: no changes. Already up to date.");

  return { changed: anyChange, lines };
}
