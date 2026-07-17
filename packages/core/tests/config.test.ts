/** Unit tests for default_enabled resolution: a pack.yml declares a rule's
 * default; .tenets/config.toml's per-rule table can override it either way.
 * Every test builds a fresh unique temp tree — the native TOML import caches
 * per absolute path, so a config path is never written twice. */

import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { find } from "../src/config";

const PACK_YML = `id: sample-pack
title: Sample Pack
description: Fixture pack for default_enabled resolution tests.
rules:
  - id: rule-default-on
    tier: deny
    summary: Enabled unless a rule table disables it.
  - id: rule-default-off
    tier: deny
    default_enabled: false
    summary: Disabled unless a rule table enables it.
  - id: rule-explicit-on
    tier: deny
    default_enabled: true
    summary: Explicitly marked enabled in the pack manifest.
`;

async function freshRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `core-config-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${root}`.quiet();
  return root;
}

async function writePack(root: string): Promise<string> {
  await Bun.write(path.join(root, "packs", "sample-pack", "pack.yml"), PACK_YML);
  return path.join(root, "packs");
}

async function writeProject(root: string, packsDir: string, extraRulesToml = ""): Promise<string> {
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "${packsDir}"
enabled = ["sample-pack"]

${extraRulesToml}
`,
  );
  return project;
}

async function loadedConfig(extraRulesToml = "") {
  const root = await freshRoot();
  const project = await writeProject(root, await writePack(root), extraRulesToml);
  const config = await find(project);
  if (!config) throw new Error("config should resolve");
  return config;
}

test("a rule with no pack default is enabled", async () => {
  expect((await loadedConfig()).ruleEnabled("rule-default-on")).toBe(true);
});

test("a rule defaulting off in pack.yml is disabled", async () => {
  expect((await loadedConfig()).ruleEnabled("rule-default-off")).toBe(false);
});

test("a rule explicitly marked default_enabled true is enabled", async () => {
  expect((await loadedConfig()).ruleEnabled("rule-explicit-on")).toBe(true);
});

test("an unmentioned rule id defaults enabled", async () => {
  expect((await loadedConfig()).ruleEnabled("some-other-rule-not-in-any-pack")).toBe(true);
});

test("config.toml can opt a default-off rule back in", async () => {
  const config = await loadedConfig("[rules.rule-default-off]\nenabled = true\n");
  expect(config.ruleEnabled("rule-default-off")).toBe(true);
});

test("a config.toml override still disables a default-on rule", async () => {
  const config = await loadedConfig("[rules.rule-default-on]\nenabled = false\n");
  expect(config.ruleEnabled("rule-default-on")).toBe(false);
});

test("a pack with no pack.yml does not crash; rules default enabled", async () => {
  const root = await freshRoot();
  const packsDir = path.join(root, "packs");
  await Bun.$`mkdir -p ${path.join(packsDir, "ghost-pack", "rules")}`.quiet();
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "${packsDir}"
enabled = ["ghost-pack"]
`,
  );
  const config = await find(project);
  if (!config) throw new Error("config should resolve");
  expect(config.ruleEnabled("anything")).toBe(true);
});

test("find returns null when no .tenets exists anywhere above", async () => {
  const root = await freshRoot();
  expect(await find(root)).toBeNull();
});

test("[core].languages as a bracket-typo scalar string throws (fails closed, not silently inert)", async () => {
  const root = await freshRoot();
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]
languages = "kotlin"
default_tier = "deny"
`,
  );
  await expect(find(project)).rejects.toThrow(/languages/);
});

test("[packs].enabled as a scalar string throws (fails closed, not silently inert)", async () => {
  const root = await freshRoot();
  const packsDir = await writePack(root);
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "${packsDir}"
enabled = "sample-pack"
`,
  );
  await expect(find(project)).rejects.toThrow(/enabled/);
});
