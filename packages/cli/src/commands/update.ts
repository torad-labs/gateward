import * as fs from "node:fs";
import * as path from "node:path";
import { parseConfigToml } from "../configToml";
import { runtimeError } from "../errors";
import { buildLock, lockPath, readLock, serializeLock, sha256, sha256File } from "../lock";
import { CORE_SRC, PACKS_ROOT, configTomlPath, engineDestDir, packsDestDir, tenetsDir } from "../paths";
import { listPacks } from "../packYaml";
import { listSourceFiles, writeIfChanged } from "../vendor";
import type { CommandOutcome } from "./add";

/** Re-vendors packs + engine from source. A file whose on-disk hash no
 * longer matches its lock entry is a local edit: it is left untouched and
 * its lock entry is not refreshed, so doctor's drift check keeps flagging it
 * correctly relative to the last real vendor point. New upstream files (not
 * yet in lock.json) are picked up; config.toml (pack selection) is untouched
 * — update never changes what's enabled, only what's on disk for what already is.
 */
export function runUpdate(root: string): CommandOutcome {
  const tDir = tenetsDir(root);
  const configPath = configTomlPath(root);
  if (!fs.existsSync(configPath)) {
    runtimeError(`${configPath} not found; run \`portable-hooks init\` first.`);
  }
  const existingLock = readLock(tDir);
  if (!existingLock) {
    runtimeError(`${lockPath(tDir)} not found; run \`portable-hooks init\` first.`);
  }

  const parsed = parseConfigToml(fs.readFileSync(configPath, "utf8"));
  const available = listPacks(PACKS_ROOT);
  const enabledPacks = parsed.packs.enabled
    .map((id) => available.find((p) => p.id === id))
    .filter((p): p is (typeof available)[number] => Boolean(p));

  const files: Record<string, string> = { ...existingLock.files };
  const updated: string[] = [];
  const added: string[] = [];
  const skipped: string[] = [];

  const syncTree = (srcDir: string, destDir: string, keyPrefix: string) => {
    for (const { relPath, absPath } of listSourceFiles(srcDir)) {
      const key = `${keyPrefix}${relPath}`;
      const destPath = path.join(destDir, relPath);
      const sourceContent = fs.readFileSync(absPath);
      const sourceHash = sha256(sourceContent);

      if (!fs.existsSync(destPath)) {
        writeIfChanged(destPath, sourceContent);
        files[key] = sourceHash;
        added.push(key);
        continue;
      }

      const lockedHash = existingLock.files[key];
      const onDiskHash = sha256File(destPath);
      if (lockedHash !== undefined && onDiskHash !== lockedHash) {
        skipped.push(key); // local edit: leave file and lock entry untouched
        continue;
      }

      const result = writeIfChanged(destPath, sourceContent);
      if (result === "updated") updated.push(key);
      files[key] = sourceHash;
    }
  };

  for (const pack of enabledPacks) {
    syncTree(pack.dir, packsDestDir(root, pack.id), `packs/${pack.id}/`);
  }
  syncTree(CORE_SRC, engineDestDir(root), "engine/");

  const newLock = buildLock(existingLock.source, files);
  const lockResult = writeIfChanged(lockPath(tDir), serializeLock(newLock));

  const changed = updated.length > 0 || added.length > 0 || lockResult !== "unchanged";

  const lines: string[] = [];
  lines.push(`Updated: ${updated.length}`);
  for (const k of updated) lines.push(`  ${k}`);
  lines.push(`Added (new upstream files): ${added.length}`);
  for (const k of added) lines.push(`  ${k}`);
  lines.push(`Skipped (local edits preserved; run update again after resolving): ${skipped.length}`);
  for (const k of skipped) lines.push(`  ${k}`);
  if (!changed) lines.push("No changes. Already up to date.");

  return { changed, lines };
}
