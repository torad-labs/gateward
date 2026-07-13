import * as assert from "node:assert/strict";
import { test } from "node:test";
import { generateConfigToml, hasCoreAndPacksSections, parseConfigToml } from "./configToml";
import type { PackMeta } from "./types";

const KOTLIN_PACK: PackMeta = {
  id: "kotlin-best-practices",
  title: "Kotlin Best Practices",
  dir: "/fake/packs/kotlin-best-practices",
  rules: [
    { id: "no-force-unwrap", tier: "deny", defaultEnabled: true, summary: "Force-unwrap is banned." },
    {
      id: "no-assert-equals-boolean",
      tier: "autofix",
      defaultEnabled: true,
      summary: "Rewritten to assertTrue/assertFalse.",
    },
  ],
};

const OPINIONATED_PACK: PackMeta = {
  id: "android-opinionated",
  title: "Android Opinionated",
  dir: "/fake/packs/android-opinionated",
  rules: [
    { id: "always-on-rule", tier: "deny", defaultEnabled: true, summary: "On unless overridden." },
    {
      id: "no-usecase-composing-usecase",
      tier: "deny",
      defaultEnabled: false,
      summary: "Off by default: house taste allows composition.",
    },
  ],
};

test("generateConfigToml: writes [core] and [packs] with languages/default_tier/packs_dir/enabled", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [KOTLIN_PACK],
  });
  assert.match(text, /^\[core\]\n/);
  assert.match(text, /languages = \["kotlin"\]/);
  assert.match(text, /default_tier = "deny"/);
  assert.match(text, /\[packs\]/);
  assert.match(text, /packs_dir = "packs"/);
  assert.match(text, /enabled = \["kotlin-best-practices"\]/);
});

test("generateConfigToml: a rule whose tier differs from default_tier gets an active [rules.<id>] override", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [KOTLIN_PACK],
  });
  assert.match(text, /\n\[rules\.no-assert-equals-boolean\]\ntier = "autofix"\n/);
  // A rule matching the project default_tier gets no override line at all.
  assert.doesNotMatch(text, /\[rules\.no-force-unwrap\]/);
});

test("generateConfigToml: default_enabled=false rules are written commented-out with an explanatory line", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [OPINIONATED_PACK],
  });
  // The explanation names the rule, the owning pack, and the pack.yml summary.
  assert.match(text, /# no-usecase-composing-usecase: disabled by default in android-opinionated\./);
  assert.match(text, /Off by default: house taste allows composition\./);
  // The actual TOML table is commented out, not active.
  assert.match(text, /# \[rules\.no-usecase-composing-usecase\]/);
  assert.match(text, /# enabled = true/);
  assert.doesNotMatch(text, /^\[rules\.no-usecase-composing-usecase\]/m);
  // A rule enabled by default and matching default_tier gets nothing at all.
  assert.doesNotMatch(text, /always-on-rule/);
});

test("generateConfigToml: is a pure function of its inputs (stable across repeated calls)", () => {
  const opts = { languages: ["kotlin"], defaultTier: "deny", packsDir: "packs", enabledPacks: [KOTLIN_PACK, OPINIONATED_PACK] };
  assert.equal(generateConfigToml(opts), generateConfigToml(opts));
});

test("parseConfigToml: reads back languages, default_tier, packs_dir, and enabled", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [KOTLIN_PACK, OPINIONATED_PACK],
  });
  const parsed = parseConfigToml(text);
  assert.deepEqual(parsed.core, { languages: ["kotlin"], defaultTier: "deny" });
  assert.equal(parsed.packs.packsDir, "packs");
  assert.deepEqual(parsed.packs.enabled, ["kotlin-best-practices", "android-opinionated"]);
});

test("hasCoreAndPacksSections: true for a generated file, false for a file missing a section", () => {
  const full = generateConfigToml({ languages: ["kotlin"], defaultTier: "deny", packsDir: "packs", enabledPacks: [] });
  assert.equal(hasCoreAndPacksSections(full), true);
  assert.equal(hasCoreAndPacksSections("[core]\nlanguages = []\n"), false);
  assert.equal(hasCoreAndPacksSections("not toml at all"), false);
});
