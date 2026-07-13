import * as fs from "node:fs";
import { generateConfigToml, parseConfigToml } from "../configToml";
import { runtimeError } from "../errors";
import { buildLock, lockPath, readLock, serializeLock } from "../lock";
import { PACKS_ROOT, configTomlPath, packsDestDir, readCliVersion, tenetsDir } from "../paths";
import { listPacks } from "../packYaml";
import type { PackMeta } from "../types";
import { removeVendored, writeIfChanged } from "../vendor";
import type { CommandOutcome } from "./add";

function enabledPackMetas(available: PackMeta[], ids: string[]): PackMeta[] {
  return ids.map((id) => available.find((p) => p.id === id)).filter((p): p is PackMeta => Boolean(p));
}

export function runRemove(root: string, packId: string): CommandOutcome {
  const configPath = configTomlPath(root);
  if (!fs.existsSync(configPath)) {
    runtimeError(`${configPath} not found; run \`portable-hooks init\` first.`);
  }

  const parsed = parseConfigToml(fs.readFileSync(configPath, "utf8"));
  if (!parsed.packs.enabled.includes(packId)) {
    return { changed: false, lines: [`Pack "${packId}" is not installed. Nothing to remove.`] };
  }

  removeVendored(packsDestDir(root, packId));

  const tDir = tenetsDir(root);
  const existingLock = readLock(tDir);
  const files = existingLock ? { ...existingLock.files } : {};
  const prefix = `packs/${packId}/`;
  for (const key of Object.keys(files)) {
    if (key.startsWith(prefix)) delete files[key];
  }
  const source = existingLock?.source ?? `portable-hooks@${readCliVersion()}`;
  writeIfChanged(lockPath(tDir), serializeLock(buildLock(source, files)));

  const newEnabledIds = parsed.packs.enabled.filter((id) => id !== packId);
  const available = listPacks(PACKS_ROOT);
  const configText = generateConfigToml({
    languages: parsed.core.languages,
    defaultTier: parsed.core.defaultTier,
    packsDir: parsed.packs.packsDir,
    enabledPacks: enabledPackMetas(available, newEnabledIds),
  });
  writeIfChanged(configPath, configText);

  return {
    changed: true,
    lines: [`Removed pack "${packId}".`, `Enabled packs: ${newEnabledIds.join(", ") || "(none)"}`],
  };
}
