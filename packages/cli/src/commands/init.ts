import { usageError } from "../cli/errors";
import { isInteractive, promptMultiselect } from "../cli/ui";
import { buildLock, lockPath, serializeLock } from "../domain/lock";
import { languagesForPacks, listPacks } from "../domain/packs";
import { generateConfigToml, parseConfigToml } from "../domain/tenetsConfig";
import { vendorDir, writeIfChanged } from "../domain/vendor";
import { detectHarnesses, WIRE_ORDER } from "../harnesses";
import { CORE_SRC, configTomlPath, engineDestDir, PACKS_ROOT, packsDestDir, readCliVersion, tenetsDir } from "../paths";
import type { CommandOutcome, HarnessDetection, PackMeta, WriteResult } from "../types";

export interface InitOptions {
  /** Raw `--packs` value: "all" or a comma-separated id list. */
  packsFlag?: string;
  yes: boolean;
}

/** A running transcript (`note`) plus a changed-anything tracker (`markChanged`),
 * threaded through every phase helper below so they all report into the same
 * `runInit` outcome instead of each building their own partial one. */
interface InitReporter {
  note: (line: string) => void;
  markChanged: (result: WriteResult) => void;
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
    return await promptMultiselect(
      available.map((p) => ({ id: p.id, label: p.title })),
      "Select rule packs to install:",
    );
  }
  usageError("Pack selection is required in non-interactive mode: pass --packs <ids|all> or -y.");
}

function reportResult(label: string, result: WriteResult): string {
  return `  ${result === "unchanged" ? "unchanged" : result.padEnd(9)} ${label}`;
}

/** Phase: logs which harnesses were detected in `root`, one line each. */
function reportDetections(note: InitReporter["note"], detections: HarnessDetection[]): void {
  note("Detected harnesses:");
  for (const d of detections) {
    note(`  ${d.harness.padEnd(9)} ${d.detected ? `yes (${d.signals.join(", ")})` : "no"}`);
  }
  note("");
}

/** Phase: vendors every selected pack into `.tenets/packs/<id>/` and returns
 * its slice of the lock file (keyed `packs/<id>/<relPath>`). */
async function vendorSelectedPacks(
  root: string,
  selectedPacks: PackMeta[],
  { note, markChanged }: InitReporter,
): Promise<Record<string, string>> {
  const lockFiles: Record<string, string> = {};
  note(`Packs (${selectedPacks.length}):`);
  for (const pack of selectedPacks) {
    const dest = packsDestDir(root, pack.id);
    // biome-ignore lint/performance/noAwaitInLoops: sequential so each pack's note line follows its own vendor results, in selection order
    const results = await vendorDir(pack.dir, dest);
    for (const r of results) {
      lockFiles[`packs/${pack.id}/${r.relPath}`] = r.hash;
      markChanged(r.result);
    }
    note(`  ${pack.id} -> .tenets/packs/${pack.id}/ (${results.length} files)`);
  }
  return lockFiles;
}

/** Phase: vendors the core engine into `.tenets/engine/` and returns its
 * slice of the lock file (keyed `engine/<relPath>`). */
async function vendorEngine(root: string, { note, markChanged }: InitReporter): Promise<Record<string, string>> {
  const lockFiles: Record<string, string> = {};
  const engineResults = await vendorDir(CORE_SRC, engineDestDir(root));
  for (const r of engineResults) {
    lockFiles[`engine/${r.relPath}`] = r.hash;
    markChanged(r.result);
  }
  note(`Engine vendored -> .tenets/engine/ (${engineResults.length} files)`);
  return lockFiles;
}

interface WireHarnessesResult {
  lockFiles: Record<string, string>;
  changed: boolean;
}

/** Phase: wires every harness adapter unconditionally (wiring is idempotent)
 * and merges their lock entries. */
async function wireHarnesses(root: string, { note }: InitReporter): Promise<WireHarnessesResult> {
  const lockFiles: Record<string, string> = {};
  let changed = false;
  // Every harness wires unconditionally (wiring is idempotent); shim-vendoring
  // adapters run first so their lock entries exist before lock.json is built.
  for (const adapter of WIRE_ORDER) {
    // biome-ignore lint/performance/noAwaitInLoops: WIRE_ORDER is a dependency order — shim-vendoring adapters must wire before lock.json is built from their entries
    const report = await adapter.wire({ root });
    Object.assign(lockFiles, report.lockEntries);
    if (report.changed) changed = true;
    for (const line of report.lines) note(line);
  }
  return { lockFiles, changed };
}

/** Same string set regardless of order. */
function sameEnabledSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Writes `.tenets/config.toml`, but never clobbers a user's hand-edited rule
 * overrides on a re-run. `generateConfigToml` regenerates the whole `[rules]`
 * section from pack defaults, so a blind rewrite would silently discard any
 * `[rules.<id>]` tier/enabled a user tuned by hand. So: if a config already
 * exists and its enabled-pack SET is unchanged, leave it exactly as-is
 * (unchanged). Only a first install, or a genuine change to which packs are
 * enabled, regenerates — and changing the pack set is what `add`/`remove` are
 * for if overrides must be preserved across that too.
 */
async function writeConfigPreservingEdits(
  root: string,
  selectedPacks: PackMeta[],
  reporter: InitReporter,
): Promise<WriteResult> {
  const configPath = configTomlPath(root);
  const configFile = Bun.file(configPath);
  if (await configFile.exists()) {
    const existing = parseConfigToml(await configFile.text());
    if (
      sameEnabledSet(
        existing.packs.enabled,
        selectedPacks.map((p) => p.id),
      )
    ) {
      reporter.note("  (kept existing .tenets/config.toml — same packs; hand-edited rule overrides preserved)");
      return "unchanged";
    }
  }
  const configText = generateConfigToml({
    languages: languagesForPacks(selectedPacks),
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: selectedPacks,
  });
  const result = await writeIfChanged(configPath, configText);
  reporter.markChanged(result);
  return result;
}

export async function runInit(root: string, opts: InitOptions): Promise<CommandOutcome> {
  const lines: string[] = [];
  let anyChange = false;
  const reporter: InitReporter = {
    note: (line: string) => lines.push(line),
    markChanged: (result: WriteResult) => {
      if (result !== "unchanged") anyChange = true;
    },
  };

  reportDetections(reporter.note, detectHarnesses(root));

  const available = await listPacks(PACKS_ROOT);
  if (available.length === 0) {
    usageError(`No packs found under ${PACKS_ROOT}.`);
  }

  const selectedIds = await resolvePackSelection(opts, available);
  const selectedPacks = selectedIds
    .map((id) => available.find((p) => p.id === id))
    .filter((p): p is PackMeta => Boolean(p));

  const lockFiles: Record<string, string> = {};
  Object.assign(lockFiles, await vendorSelectedPacks(root, selectedPacks, reporter));
  Object.assign(lockFiles, await vendorEngine(root, reporter));

  const wired = await wireHarnesses(root, reporter);
  Object.assign(lockFiles, wired.lockFiles);
  if (wired.changed) anyChange = true;

  const configResult = await writeConfigPreservingEdits(root, selectedPacks, reporter);
  reporter.note(reportResult(".tenets/config.toml", configResult));

  const lock = buildLock(`portable-hooks@${await readCliVersion()}`, lockFiles);
  const lockResult = await writeIfChanged(lockPath(tenetsDir(root)), serializeLock(lock));
  reporter.markChanged(lockResult);
  reporter.note(reportResult(`.tenets/lock.json (${Object.keys(lockFiles).length} files)`, lockResult));

  reporter.note("");
  reporter.note(anyChange ? "portable-hooks: init complete." : "portable-hooks: no changes. Already up to date.");

  return { changed: anyChange, lines };
}
