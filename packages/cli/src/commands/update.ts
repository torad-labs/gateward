import * as path from "node:path";
import { runtimeError } from "../cli/errors";
import { buildLock, lockPath, readLock, serializeLock, sha256, sha256File } from "../domain/lock";
import { listPacks } from "../domain/packs";
import { parseConfigToml } from "../domain/tenetsConfig";
import { listSourceFiles, writeIfChanged } from "../domain/vendor";
import { CORE_SRC, configTomlPath, engineDestDir, PACKS_ROOT, packsDestDir, tenetsDir } from "../paths";
import type { CommandOutcome } from "../types";

type SyncOutcome = "added" | "updated" | "skipped" | "unchanged";

interface FileSyncResult {
  outcome: SyncOutcome;
  /** This file's current-source hash, valid regardless of outcome (the
   * caller only records it into the new lock when outcome isn't "skipped"). */
  hash: string;
}

/** Decides and applies the sync outcome for one source file relative to its
 * lock entry: writes new upstream files ("added"), refreshes files whose
 * on-disk hash still matches the lock ("updated"/"unchanged"), and leaves
 * local edits — an on-disk hash that no longer matches its lock entry —
 * untouched ("skipped") so doctor's drift check keeps flagging them correctly
 * relative to the last real vendor point. */
async function syncOneFile(
  absPath: string,
  destPath: string,
  key: string,
  lockedFiles: Record<string, string>,
): Promise<FileSyncResult> {
  const sourceContent = await Bun.file(absPath).bytes();
  const sourceHash = sha256(sourceContent);

  if (!(await Bun.file(destPath).exists())) {
    await writeIfChanged(destPath, sourceContent);
    return { outcome: "added", hash: sourceHash };
  }

  const lockedHash = lockedFiles[key];
  const onDiskHash = await sha256File(destPath);
  if (lockedHash !== undefined && onDiskHash !== lockedHash) {
    return { outcome: "skipped", hash: sourceHash }; // local edit: leave file and lock entry untouched
  }

  const result = await writeIfChanged(destPath, sourceContent);
  return { outcome: result === "updated" ? "updated" : "unchanged", hash: sourceHash };
}

/** Formats the `Updated`/`Added`/`Skipped` report lines from one update pass. */
function formatSyncReport(updated: string[], added: string[], skipped: string[], changed: boolean): string[] {
  const lines: string[] = [];
  lines.push(`Updated: ${updated.length}`);
  for (const k of updated) lines.push(`  ${k}`);
  lines.push(`Added (new upstream files): ${added.length}`);
  for (const k of added) lines.push(`  ${k}`);
  lines.push(`Skipped (local edits preserved; run update again after resolving): ${skipped.length}`);
  for (const k of skipped) lines.push(`  ${k}`);
  if (!changed) lines.push("No changes. Already up to date.");
  return lines;
}

/** Re-vendors packs + engine from source. A file whose on-disk hash no
 * longer matches its lock entry is a local edit: it is left untouched and
 * its lock entry is not refreshed, so doctor's drift check keeps flagging it
 * correctly relative to the last real vendor point. New upstream files (not
 * yet in lock.json) are picked up; config.toml (pack selection) is untouched
 * — update never changes what's enabled, only what's on disk for what already is.
 */
export async function runUpdate(root: string): Promise<CommandOutcome> {
  const tDir = tenetsDir(root);
  const configPath = configTomlPath(root);
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    runtimeError(`${configPath} not found; run \`portable-hooks init\` first.`);
  }
  const existingLock = await readLock(tDir);
  if (!existingLock) {
    runtimeError(`${lockPath(tDir)} not found; run \`portable-hooks init\` first.`);
  }

  const parsed = parseConfigToml(await configFile.text());
  const available = await listPacks(PACKS_ROOT);
  const enabledPacks = parsed.packs.enabled
    .map((id) => available.find((p) => p.id === id))
    .filter((p): p is (typeof available)[number] => Boolean(p));

  const files: Record<string, string> = { ...existingLock.files };
  const updated: string[] = [];
  const added: string[] = [];
  const skipped: string[] = [];

  const syncTree = async (srcDir: string, destDir: string, keyPrefix: string) => {
    for (const { relPath, absPath } of await listSourceFiles(srcDir)) {
      const key = `${keyPrefix}${relPath}`;
      const destPath = path.join(destDir, relPath);
      // biome-ignore lint/performance/noAwaitInLoops: each file's write must land before the next file's exists()/hash check reads the same destDir
      const { outcome, hash } = await syncOneFile(absPath, destPath, key, existingLock.files);
      if (outcome !== "skipped") files[key] = hash;
      if (outcome === "added") added.push(key);
      else if (outcome === "updated") updated.push(key);
      else if (outcome === "skipped") skipped.push(key);
    }
  };

  for (const pack of enabledPacks) {
    // biome-ignore lint/performance/noAwaitInLoops: each pack's tree must finish syncing before the next starts, so `added`/`updated`/`skipped` reflect one consistent pass
    await syncTree(pack.dir, packsDestDir(root, pack.id), `packs/${pack.id}/`);
  }
  await syncTree(CORE_SRC, engineDestDir(root), "engine/");

  const newLock = buildLock(existingLock.source, files);
  const lockResult = await writeIfChanged(lockPath(tDir), serializeLock(newLock));

  const changed = updated.length > 0 || added.length > 0 || lockResult !== "unchanged";
  const lines = formatSyncReport(updated, added, skipped, changed);

  return { changed, lines };
}
