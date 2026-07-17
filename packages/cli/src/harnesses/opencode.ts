/** OpenCode adapter: vendors the plugin into `.opencode/plugins/`.
 * Test-shaped files (e.g. smoke-test.js) are excluded: OpenCode scans its
 * whole plugins/ directory, so a stray dev-test script vendored in there
 * would be loaded as a plugin too, unlike Codex (which references one
 * specific file path and is unaffected by extra files sitting alongside it).
 * `node:fs` here is structural-only (directory existence). */
import * as fs from "node:fs";
import * as path from "node:path";
import { readLock, sha256File } from "../domain/lock";
import { looksLikeTestFile, vendorInto } from "../domain/vendor";
import { engineDestDir, SHIMS_ROOT, tenetsDir } from "../paths";
import type { DoctorCheck } from "../types";
import type { HarnessAdapter, WireContext, WireReport } from "./adapter";

function pluginBasename(): string | null {
  if (!fs.existsSync(path.join(SHIMS_ROOT, "opencode"))) return null;
  const entries = fs
    .readdirSync(path.join(SHIMS_ROOT, "opencode"), { withFileTypes: true })
    .filter((e) => e.isFile() && !looksLikeTestFile(e.name))
    .map((e) => e.name)
    .sort();
  return entries[0] ?? null;
}

async function wire({ root }: WireContext): Promise<WireReport> {
  const shimSrc = path.join(SHIMS_ROOT, "opencode");
  if (!fs.existsSync(shimSrc)) {
    return { lines: ["opencode: engine plugin not present in source, skipped"], lockEntries: {}, changed: false };
  }
  // Two copies, one truth: the lock-covered copy lives with the engine
  // (drift-visible to doctor/update); the runtime copy OpenCode actually
  // loads sits in .opencode/plugins/. Test-shaped files stay out of the
  // runtime dir — OpenCode loads every file in plugins/ as a plugin.
  const lockEntries: Record<string, string> = {};
  let changed = false;
  const engineDest = path.join(engineDestDir(root), "shims", "opencode");
  const engineCopies = await vendorInto(shimSrc, engineDest, { exclude: looksLikeTestFile });
  for (const r of engineCopies) {
    lockEntries[`engine/shims/opencode/${r.relPath}`] = r.hash;
    if (r.result !== "unchanged") changed = true;
  }
  const runtimeDest = path.join(root, ".opencode", "plugins");
  const results = await vendorInto(shimSrc, runtimeDest, { exclude: looksLikeTestFile });
  for (const r of results) {
    if (r.result !== "unchanged") changed = true;
  }
  return {
    lines: [
      `OpenCode plugin vendored -> .opencode/plugins/ (${results.length} files, lock-covered under engine/shims/opencode/)`,
    ],
    lockEntries,
    changed,
  };
}

async function check(root: string): Promise<DoctorCheck> {
  const basename = pluginBasename();
  if (basename === null) {
    return {
      name: "harness:opencode",
      status: "warn",
      message: "OpenCode detected, but portable-hooks has no OpenCode plugin yet.",
      remedy: "upgrade portable-hooks once the OpenCode plugin ships; not fixable today",
    };
  }
  const pluginPath = path.join(root, ".opencode", "plugins", basename);
  if (!(await Bun.file(pluginPath).exists())) {
    return {
      name: "harness:opencode",
      status: "fail",
      message: "OpenCode detected but the portable-hooks plugin is not installed.",
      remedy: "run `portable-hooks init`",
    };
  }
  const lock = await readLock(tenetsDir(root));
  const lockedHash = lock?.files[`engine/shims/opencode/${basename}`];
  if (lockedHash !== undefined && (await sha256File(pluginPath)) !== lockedHash) {
    return {
      name: "harness:opencode",
      status: "warn",
      message: "OpenCode runtime plugin differs from the lock-covered engine copy.",
      remedy: `re-run \`portable-hooks init\` to refresh .opencode/plugins/${basename}`,
    };
  }
  return { name: "harness:opencode", status: "pass", message: "OpenCode plugin installed." };
}

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  signals: [".opencode"],
  wire,
  check,
};
