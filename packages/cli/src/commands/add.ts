import { runtimeError, usageError } from "../cli/errors";
import { buildLock, lockPath, readLock, serializeLock } from "../domain/lock";
import { languagesForPacks, listPacks } from "../domain/packs";
import { generateConfigToml, parseConfigToml } from "../domain/tenetsConfig";
import { vendorDir, writeIfChanged } from "../domain/vendor";
import { configTomlPath, PACKS_ROOT, packsDestDir, readCliVersion, tenetsDir } from "../paths";
import type { CommandOutcome, PackMeta } from "../types";

function enabledPackMetas(available: PackMeta[], ids: string[]): PackMeta[] {
  return ids.map((id) => available.find((p) => p.id === id)).filter((p): p is PackMeta => Boolean(p));
}

export async function runAdd(root: string, packId: string): Promise<CommandOutcome> {
  const configPath = configTomlPath(root);
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    runtimeError(`${configPath} not found; run \`portable-hooks init\` first.`);
  }

  const available = await listPacks(PACKS_ROOT);
  const pack = available.find((p) => p.id === packId);
  if (!pack) {
    usageError(`Unknown pack id "${packId}". Available: ${available.map((p) => p.id).join(", ") || "(none)"}`);
  }

  const parsed = parseConfigToml(await configFile.text());
  if (parsed.packs.enabled.includes(packId)) {
    return { changed: false, lines: [`Pack "${packId}" is already installed. No changes.`] };
  }

  const tDir = tenetsDir(root);
  const existingLock = (await readLock(tDir)) ?? buildLock(`portable-hooks@${await readCliVersion()}`, {});
  const files = { ...existingLock.files };
  const results = await vendorDir(pack.dir, packsDestDir(root, packId));
  for (const r of results) files[`packs/${packId}/${r.relPath}`] = r.hash;
  await writeIfChanged(lockPath(tDir), serializeLock(buildLock(existingLock.source, files)));

  const newEnabledIds = [...parsed.packs.enabled, packId];
  const newEnabledPacks = enabledPackMetas(available, newEnabledIds);
  const configText = generateConfigToml({
    // Languages are re-derived from the new enabled-pack set, not copied
    // from the existing file: adding the first pack of a new language must
    // start gating that language's files.
    languages: languagesForPacks(newEnabledPacks),
    defaultTier: parsed.core.defaultTier,
    packsDir: parsed.packs.packsDir,
    enabledPacks: newEnabledPacks,
  });
  await writeIfChanged(configPath, configText);

  return {
    changed: true,
    lines: [`Added pack "${packId}" (${results.length} files vendored).`, `Enabled packs: ${newEnabledIds.join(", ")}`],
  };
}
