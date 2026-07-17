/**
 * Source-side path resolution.
 *
 * This package lives inside the portable-hooks monorepo at
 * `packages/cli/`. It vendors two sibling trees that it does NOT own or
 * publish itself: the engine (`packages/core/src/`) and the rule
 * packs (`packs/`), plus optional per-harness shims (`packages/shims/`).
 *
 * Paths are resolved relative to *this module's own location*
 * (`import.meta.dir`, three levels up from `src/` — the CLI runs directly
 * from TypeScript source under Bun, there is no build step), never
 * `process.cwd()` — `process.cwd()` is reserved for "the target project"
 * (where `.tenets/` gets written). This lets the CLI be invoked with any
 * working directory (as the integration test does, from a temp dir) while
 * still finding its own vendored sources.
 *
 * Known limitation: this only works when packages/cli runs from inside a
 * checkout that also has packages/core and packs/ as siblings (true today,
 * pre-publish). Publishing this package standalone will need a packaging
 * step that bundles core/src, packs/, and packages/shims into the published
 * tarball and updates these paths accordingly — tracked on the roadmap.
 */
import * as path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
export const CORE_SRC = path.join(REPO_ROOT, "packages", "core", "src");
export const PACKS_ROOT = path.join(REPO_ROOT, "packs");
export const SHIMS_ROOT = path.join(REPO_ROOT, "packages", "shims");
export const CLI_PACKAGE_JSON = path.join(REPO_ROOT, "packages", "cli", "package.json");

/** The project this CLI is being run against: always the current working directory. */
export function projectRoot(): string {
  return process.cwd();
}

export const TENETS_DIR = ".tenets";

export function tenetsDir(root: string): string {
  return path.join(root, TENETS_DIR);
}

export function packsDestDir(root: string, packId: string): string {
  return path.join(tenetsDir(root), "packs", packId);
}

export function engineDestDir(root: string): string {
  return path.join(tenetsDir(root), "engine");
}

export function configTomlPath(root: string): string {
  return path.join(tenetsDir(root), "config.toml");
}

export async function readCliVersion(): Promise<string> {
  const pkg = (await Bun.file(CLI_PACKAGE_JSON).json()) as { version: string };
  return pkg.version;
}
