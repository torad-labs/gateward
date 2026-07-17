import { runtimeError } from "../cli/errors";
import { buildLock, lockPath, readLock, serializeLock } from "../domain/lock";
import { languagesForPacks, listPacks } from "../domain/packs";
import { generateConfigToml, parseConfigToml } from "../domain/tenetsConfig";
import { removeVendored, writeIfChanged } from "../domain/vendor";
import { configTomlPath, PACKS_ROOT, packsDestDir, readCliVersion, tenetsDir } from "../paths";
import type { CommandOutcome, PackMeta } from "../types";

function enabledPackMetas(available: PackMeta[], ids: string[]): PackMeta[] {
  return ids.map((id) => available.find((p) => p.id === id)).filter((p): p is PackMeta => Boolean(p));
}

export async function runRemove(root: string, packId: string): Promise<CommandOutcome> {
  const configPath = configTomlPath(root);
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    runtimeError(`${configPath} not found; run \`portable-hooks init\` first.`);
  }

  const parsed = parseConfigToml(await configFile.text());
  if (!parsed.packs.enabled.includes(packId)) {
    return { changed: false, lines: [`Pack "${packId}" is not installed. Nothing to remove.`] };
  }

  await removeVendored(packsDestDir(root, packId));

  const tDir = tenetsDir(root);
  const existingLock = await readLock(tDir);
  const files = existingLock ? { ...existingLock.files } : {};
  const prefix = `packs/${packId}/`;
  for (const key of Object.keys(files)) {
    if (key.startsWith(prefix)) delete files[key];
  }
  const source = existingLock?.source ?? `portable-hooks@${await readCliVersion()}`;
  await writeIfChanged(lockPath(tDir), serializeLock(buildLock(source, files)));

  const newEnabledIds = parsed.packs.enabled.filter((id) => id !== packId);
  const available = await listPacks(PACKS_ROOT);
  const newEnabledPacks = enabledPackMetas(available, newEnabledIds);
  const configText = generateConfigToml({
    // Re-derived, mirroring add.ts: removing the last pack of a language
    // must stop gating that language's files.
    languages: languagesForPacks(newEnabledPacks),
    defaultTier: parsed.core.defaultTier,
    packsDir: parsed.packs.packsDir,
    enabledPacks: newEnabledPacks,
  });
  await writeIfChanged(configPath, configText);

  return {
    changed: true,
    lines: [`Removed pack "${packId}".`, `Enabled packs: ${newEnabledIds.join(", ") || "(none)"}`],
  };
}
