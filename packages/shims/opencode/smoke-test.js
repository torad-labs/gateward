#!/usr/bin/env node
"use strict";

/**
 * Node smoke test for the OpenCode plugin: run `node smoke-test.js`.
 *
 * Imports the plugin, builds a real temp project (a real .tenets/config.toml
 * pointing at this repo's real packs), and feeds tool.execute.before a
 * stubbed input/output pair for a force-unwrap ("!!") write — asserting it
 * throws — then a clean write — asserting it passes. Exercises the whole
 * chain (plugin -> spawnSync python3 -> core's real pretooluse.py -> real
 * ast-grep), not just the JS-side plumbing.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { PortableHooksPlugin } = require("./portable-hooks.js");

const PACKS_DIR = path.join(__dirname, "..", "..", "..", "packs");
const CONFIG_TOML = `[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "${PACKS_DIR}"
enabled = ["kotlin-best-practices"]
`;

async function main() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "portable-hooks-opencode-smoke-"));
  fs.mkdirSync(path.join(project, ".tenets"));
  fs.writeFileSync(path.join(project, ".tenets", "config.toml"), CONFIG_TOML, "utf8");

  const hooks = await PortableHooksPlugin({ directory: project });
  const before = hooks["tool.execute.before"];

  const badOutput = { args: { filePath: path.join(project, "Bad.kt"), content: "val x = y!!\n" } };
  await assert.rejects(
    () => before({ tool: "write" }, badOutput),
    (err) => err instanceof Error && err.message.length > 0,
    "expected the hook to throw for a force-unwrap write",
  );

  const goodOutput = { args: { filePath: path.join(project, "Good.kt"), content: "val x = 1\n" } };
  await before({ tool: "write" }, goodOutput); // must not throw

  fs.rmSync(project, { recursive: true, force: true });
  console.log("PASS  opencode smoke test (force-unwrap denies, clean write allows)");
}

main().catch((err) => {
  console.error("FAIL ", err);
  process.exitCode = 1;
});
