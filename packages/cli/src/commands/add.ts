import * as fs from "node:fs";
import { generateConfigToml, parseConfigToml } from "../configToml";
import { runtimeError, usageError } from "../errors";
import { buildLock, lockPath, readLock, serializeLock } from "../lock";
import { PACKS_ROOT, configTomlPath, packsDestDir, readCliVersion, tenetsDir } from "../paths";
import { listPacks } from "../packYaml";
import type { PackMeta } from "../types";
import { vendorDir, writeIfChanged } from "../vendor";

export interface CommandOutcome {
  changed: boolean;
  lines: string[];
}

function enabledPackMetas(available: PackMeta[], ids: string[]): PackMeta[] {
  return ids.map((id) => available.find((p) => p.id === id)).filter((p): p is PackMeta => Boolean(p));
}

export function runAdd(root: string, packId: string): CommandOutcome {
  const configPath = configTomlPath(root);
  if (!fs.existsSync(configPath)) {
    runtimeError(`${configPath} not found; run \`portable-hooks init\` first.`);
  }

  const available = listPacks(PACKS_ROOT);
  const pack = available.find((p) => p.id === packId);
  if (!pack) {
    usageError(`Unknown pack id "${packId}". Available: ${available.map((p) => p.id).join(", ") || "(none)"}`);
  }

  const parsed = parseConfigToml(fs.readFileSync(configPath, "utf8"));
  if (parsed.packs.enabled.includes(packId)) {
    return { changed: false, lines: [`Pack "${packId}" is already installed. No changes.`] };
  }

  const tDir = tenetsDir(root);
  const existingLock = readLock(tDir) ?? buildLock(`portable-hooks@${readCliVersion()}`, {});
  const files = { ...existingLock.files };
  const results = vendorDir(pack.dir, packsDestDir(root, packId));
  for (const r of results) files[`packs/${packId}/${r.relPath}`] = r.hash;
  writeIfChanged(lockPath(tDir), serializeLock(buildLock(existingLock.source, files)));

  const newEnabledIds = [...parsed.packs.enabled, packId];
  const configText = generateConfigToml({
    languages: parsed.core.languages,
    defaultTier: parsed.core.defaultTier,
    packsDir: parsed.packs.packsDir,
    enabledPacks: enabledPackMetas(available, newEnabledIds),
  });
  writeIfChanged(configPath, configText);

  return {
    changed: true,
    lines: [`Added pack "${packId}" (${results.length} files vendored).`, `Enabled packs: ${newEnabledIds.join(", ")}`],
  };
}
