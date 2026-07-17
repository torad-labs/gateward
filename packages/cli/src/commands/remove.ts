import * as path from "node:path";
import { runtimeError, usageError } from "../cli/errors";
import { buildLock, lockPath, readLock, serializeLock } from "../domain/lock";
import { languagesForPacks, listPacks } from "../domain/packs";
import { generateConfigToml, parseConfigToml } from "../domain/tenetsConfig";
import { removeVendored, writeIfChanged } from "../domain/vendor";
import { configTomlPath, PACKS_ROOT, packsDestDir, readCliVersion, tenetsDir } from "../paths";
import type { CommandOutcome, PackMeta } from "../types";

function enabledPackMetas(available: PackMeta[], ids: string[]): PackMeta[] {
  return ids.map((id) => available.find((p) => p.id === id)).filter((p): p is PackMeta => Boolean(p));
}

/** Asserts `destDir` resolves to a path inside `tenetsRoot`. Defense in
 * depth for the delete below: packId is already resolved against the
 * trusted listPacks() set (whose ids are themselves char-validated in
 * packs.ts), so this should never trip — but a recursive delete is
 * dangerous enough to double-check the path shape it's about to act on. */
function assertWithinTenets(destDir: string, tenetsRoot: string): void {
  const resolvedDest = path.resolve(destDir);
  const resolvedRoot = path.resolve(tenetsRoot);
  const rel = path.relative(resolvedRoot, resolvedDest);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`refusing to remove "${resolvedDest}": it is not inside "${resolvedRoot}".`);
  }
}

export async function runRemove(root: string, packId: string): Promise<CommandOutcome> {
  const configPath = configTomlPath(root);
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    runtimeError(`${configPath} not found; run \`portable-hooks init\` first.`);
  }

  const parsed = parseConfigToml(await configFile.text());

  // Resolve packId against the trusted, char-validated pack registry —
  // never trust the CLI-supplied packId (or even config.toml's own
  // [packs] enabled array) directly as a path segment. A packId that
  // isn't a real known pack is refused outright, before any deletion.
  const available = await listPacks(PACKS_ROOT);
  const resolved = available.find((p) => p.id === packId);
  if (!resolved) {
    usageError(`Unknown pack id "${packId}". Available: ${available.map((p) => p.id).join(", ") || "(none)"}`);
  }

  if (!parsed.packs.enabled.includes(packId)) {
    return { changed: false, lines: [`Pack "${packId}" is not installed. Nothing to remove.`] };
  }

  const destDir = packsDestDir(root, packId);
  assertWithinTenets(destDir, tenetsDir(root));
  await removeVendored(destDir);

  const tDir = tenetsDir(root);
  const existingLock = await readLock(tDir);
  const prefix = `packs/${packId}/`;
  const files = existingLock
    ? Object.fromEntries(Object.entries(existingLock.files).filter(([key]) => !key.startsWith(prefix)))
    : {};
  const source = existingLock?.source ?? `portable-hooks@${await readCliVersion()}`;
  await writeIfChanged(lockPath(tDir), serializeLock(buildLock(source, files)));

  const newEnabledIds = parsed.packs.enabled.filter((id) => id !== packId);
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
