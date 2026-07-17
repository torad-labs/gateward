/** Codex adapter: vendors the Codex shim next to the engine and wires
 * `.codex/hooks.json`. Only wired when packages/shims/codex exists in source
 * at the moment init runs (checked fresh every run, never hardcoded — see
 * repo-structure.md's F1/decision-7 and settingsMerge.ts's doc comment).
 * `node:fs` here is structural-only (directory existence + listing). */
import * as fs from "node:fs";
import * as path from "node:path";
import { looksLikeTestFile, vendorInto, writeIfChanged } from "../domain/vendor";
import { engineDestDir, SHIMS_ROOT } from "../paths";
import type { DoctorCheck } from "../types";
import type { HarnessAdapter, WireContext, WireReport } from "./adapter";
import { type MergeResult, mergePreToolUseHook } from "./settingsMerge";

/**
 * Wires the vendored Codex shim into .codex/hooks.json. Codex adopted Claude
 * Code's hook JSON (research/harness-hooks-matrix.md), so the entry mirrors
 * mergeClaudeSettings. The command is bun plus a project-relative path —
 * Codex documents no project-dir env var, so we rely on project hooks running
 * from the project root. Unconfirmed against a real Codex install; the shim's
 * own docstring carries the same flag.
 *
 * The matcher is `apply_patch`, NOT Claude's `Write|Edit`: Codex edits files
 * through its single `apply_patch` tool, and the shim only translates that
 * tool. A `Write|Edit` matcher would never fire on Codex's actual tool call,
 * silently leaving Codex ungated (fail open) — matching the tool the shim
 * projects is what makes the gate run at all.
 *
 * `timeout` must exceed the engine's own internal scan budget so the engine's
 * fail-closed deny fires before the harness kills the hook. The engine runs
 * up to two scans plus an optional autofix, each bounded by scan.ts's
 * DEFAULT_TIMEOUT_MS (8s); 30s leaves comfortable headroom. A harness that
 * kills the hook first would treat it as non-blocking (fail open), so this
 * ceiling is a security parameter, not a nicety.
 */
export function mergeCodexHooks(existingText: string | null, relEntrypoint: string): MergeResult {
  return mergePreToolUseHook(existingText, relEntrypoint, {
    matcher: "apply_patch",
    hooks: [{ type: "command", command: `bun ${JSON.stringify(relEntrypoint)}`, timeout: 30 }],
  });
}

/** Finds the shim's entrypoint file for wiring purposes. Prefers an
 * `entry.*` file (a convention this CLI assumes, mirroring core's own
 * `events/*` naming); otherwise the first non-test-shaped top-level file,
 * sorted, so wiring is deterministic. Excluding test-shaped names matters in
 * practice: the codex shim ships `claude_compat.ts` alongside
 * `claude_compat.test.ts` in the same flat directory. Falls back to any file
 * at all (even test-shaped) rather than throwing, as a last resort. */
async function findShimEntrypoint(shimDestDir: string): Promise<string> {
  for (const candidate of ["entry.ts", "entry.py", "entry.js"]) {
    const candidatePath = path.join(shimDestDir, candidate);
    // biome-ignore lint/performance/noAwaitInLoops: short-circuits on the first existing candidate, in preference order
    if (await Bun.file(candidatePath).exists()) return candidatePath;
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

async function wire({ root }: WireContext): Promise<WireReport> {
  const shimSrc = path.join(SHIMS_ROOT, "codex");
  if (!fs.existsSync(shimSrc)) {
    return { lines: ["codex: engine shim not present in source, skipped"], lockEntries: {}, changed: false };
  }
  const lockEntries: Record<string, string> = {};
  let changed = false;
  const dest = path.join(engineDestDir(root), "shims", "codex");
  // Exclude test-shaped files (e.g. claude_compat.test.ts): the vendored
  // engine ships the shim, not its test suite. Mirrors the OpenCode adapter.
  const shimResults = await vendorInto(shimSrc, dest, { exclude: looksLikeTestFile });
  for (const r of shimResults) {
    lockEntries[`engine/shims/codex/${r.relPath}`] = r.hash;
    if (r.result !== "unchanged") changed = true;
  }
  const entrypoint = await findShimEntrypoint(dest);
  const relEntry = path.relative(root, entrypoint);
  const hooksPath = path.join(root, ".codex", "hooks.json");
  const hooksFile = Bun.file(hooksPath);
  const existing = (await hooksFile.exists()) ? await hooksFile.text() : null;
  let merged: MergeResult;
  try {
    merged = mergeCodexHooks(existing, relEntry);
  } catch (err) {
    throw new Error(`.codex/hooks.json exists but is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
  const result = await writeIfChanged(hooksPath, merged.text);
  if (result !== "unchanged") changed = true;
  return {
    lines: [`Codex wired -> .codex/hooks.json (${merged.changed ? "added hook" : "already wired"})`],
    lockEntries,
    changed,
  };
}

async function check(root: string): Promise<DoctorCheck> {
  if (!fs.existsSync(path.join(SHIMS_ROOT, "codex"))) {
    return {
      name: "harness:codex",
      status: "warn",
      message: "Codex detected, but portable-hooks has no Codex shim yet.",
      remedy: "upgrade portable-hooks once the Codex shim ships; not fixable today",
    };
  }
  const hooksFile = Bun.file(path.join(root, ".codex", "hooks.json"));
  const wired = (await hooksFile.exists()) && (await hooksFile.text()).includes(".tenets/engine/shims/codex/");
  if (!wired) {
    return {
      name: "harness:codex",
      status: "fail",
      message: "Codex detected but not wired.",
      remedy: "run `portable-hooks init`",
    };
  }
  return { name: "harness:codex", status: "pass", message: "Codex hook wired." };
}

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  signals: [".codex", ".codex/hooks.json"],
  wire,
  check,
};
