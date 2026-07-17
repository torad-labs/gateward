import { usageError } from "../cli/errors";
import { isInteractive, promptMultiselect } from "../cli/ui";
import { buildLock, lockPath, serializeLock } from "../domain/lock";
import { languagesForPacks, listPacks } from "../domain/packs";
import { generateConfigToml } from "../domain/tenetsConfig";
import { vendorDir, writeIfChanged } from "../domain/vendor";
import { detectHarnesses, WIRE_ORDER } from "../harnesses";
import { CORE_SRC, configTomlPath, engineDestDir, PACKS_ROOT, packsDestDir, readCliVersion, tenetsDir } from "../paths";
import type { CommandOutcome, PackMeta, WriteResult } from "../types";

export interface InitOptions {
  /** Raw `--packs` value: "all" or a comma-separated id list. */
  packsFlag?: string;
  yes: boolean;
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

export async function runInit(root: string, opts: InitOptions): Promise<CommandOutcome> {
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

  const available = await listPacks(PACKS_ROOT);
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
    const results = await vendorDir(pack.dir, dest);
    for (const r of results) {
      lockFiles[`packs/${pack.id}/${r.relPath}`] = r.hash;
      markChanged(r.result);
    }
    note(`  ${pack.id} -> .tenets/packs/${pack.id}/ (${results.length} files)`);
  }

  const engineResults = await vendorDir(CORE_SRC, engineDestDir(root));
  for (const r of engineResults) {
    lockFiles[`engine/${r.relPath}`] = r.hash;
    markChanged(r.result);
  }
  note(`Engine vendored -> .tenets/engine/ (${engineResults.length} files)`);

  // Every harness wires unconditionally (wiring is idempotent); shim-vendoring
  // adapters run first so their lock entries exist before lock.json is built.
  for (const adapter of WIRE_ORDER) {
    const report = await adapter.wire({ root });
    Object.assign(lockFiles, report.lockEntries);
    if (report.changed) anyChange = true;
    for (const line of report.lines) note(line);
  }

  const languages = languagesForPacks(selectedPacks);
  const configText = generateConfigToml({
    languages,
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: selectedPacks,
  });
  const configResult = await writeIfChanged(configTomlPath(root), configText);
  markChanged(configResult);
  note(reportResult(".tenets/config.toml", configResult));

  const lock = buildLock(`portable-hooks@${await readCliVersion()}`, lockFiles);
  const lockResult = await writeIfChanged(lockPath(tenetsDir(root)), serializeLock(lock));
  markChanged(lockResult);
  note(reportResult(`.tenets/lock.json (${Object.keys(lockFiles).length} files)`, lockResult));

  note("");
  note(anyChange ? "portable-hooks: init complete." : "portable-hooks: no changes. Already up to date.");

  return { changed: anyChange, lines };
}
