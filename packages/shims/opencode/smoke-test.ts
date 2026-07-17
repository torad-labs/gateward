#!/usr/bin/env bun
/**
 * Bun smoke test for the OpenCode plugin: run `bun smoke-test.ts`.
 *
 * Imports the plugin, builds a real temp project (a real .tenets/config.toml
 * pointing at this repo's real packs), and feeds tool.execute.before a
 * stubbed input/output pair for a force-unwrap ("!!") write — asserting it
 * throws — then a clean write — asserting it passes. Exercises the whole
 * chain (plugin -> Bun.spawnSync -> core's real pretooluse.ts -> real
 * ast-grep), not just the plugin-side plumbing.
 */
import * as os from "node:os";
import * as path from "node:path";
import GatewardPlugin from "./gateward";

const PACKS_DIR = path.join(import.meta.dir, "..", "..", "..", "packs");
const CONFIG_TOML = `[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "${PACKS_DIR}"
enabled = ["kotlin-best-practices"]
`;

async function main(): Promise<void> {
  const project = path.join(os.tmpdir(), `gateward-opencode-smoke-${crypto.randomUUID()}`);
  await Bun.write(path.join(project, ".tenets", "config.toml"), CONFIG_TOML);

  const hooks = await GatewardPlugin({ directory: project });
  const before = hooks["tool.execute.before"];

  const badOutput = { args: { filePath: path.join(project, "Bad.kt"), content: "val x = y!!\n" } };
  let denied = false;
  try {
    await before({ tool: "write" }, badOutput);
  } catch (err) {
    denied = err instanceof Error && err.message.length > 0;
  }
  if (!denied) throw new Error("expected the hook to throw for a force-unwrap write");

  const goodOutput = { args: { filePath: path.join(project, "Good.kt"), content: "val x = 1\n" } };
  await before({ tool: "write" }, goodOutput); // must not throw

  await Bun.$`rm -rf ${project}`.quiet();
  console.log("PASS  opencode smoke test (force-unwrap denies, clean write allows)");
}

try {
  await main();
} catch (err) {
  console.error("FAIL ", err);
  process.exitCode = 1;
}
