import { expect, test } from "bun:test";
import type { PackMeta } from "../types";
import { generateConfigToml, hasCoreAndPacksSections, parseConfigToml } from "./tenetsConfig";

const CORE_HEADER_RE = /^\[core\]\n/;
const LANGUAGES_KOTLIN_RE = /languages = \["kotlin"\]/;
const DEFAULT_TIER_DENY_RE = /default_tier = "deny"/;
const PACKS_HEADER_RE = /\[packs\]/;
const PACKS_DIR_RE = /packs_dir = "packs"/;
const ENABLED_KOTLIN_BEST_PRACTICES_RE = /enabled = \["kotlin-best-practices"\]/;
const ASSERT_EQUALS_BOOLEAN_OVERRIDE_RE = /\n\[rules\.no-assert-equals-boolean\]\ntier = "autofix"\n/;
const FORCE_UNWRAP_RULE_TABLE_RE = /\[rules\.no-force-unwrap\]/;
const USECASE_COMPOSING_DISABLED_COMMENT_RE =
  /# no-usecase-composing-usecase: disabled by default in android-opinionated\./;
const OFF_BY_DEFAULT_SUMMARY_RE = /Off by default: house taste allows composition\./;
const USECASE_COMPOSING_COMMENTED_TABLE_RE = /# \[rules\.no-usecase-composing-usecase\]/;
const COMMENTED_ENABLED_TRUE_RE = /# enabled = true/;
const USECASE_COMPOSING_ACTIVE_TABLE_RE = /^\[rules\.no-usecase-composing-usecase\]/m;
const ALWAYS_ON_RULE_MENTION_RE = /always-on-rule/;

const KOTLIN_PACK: PackMeta = {
  id: "kotlin-best-practices",
  title: "Kotlin Best Practices",
  language: "kotlin",
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
  language: "kotlin",
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
  expect(text).toMatch(CORE_HEADER_RE);
  expect(text).toMatch(LANGUAGES_KOTLIN_RE);
  expect(text).toMatch(DEFAULT_TIER_DENY_RE);
  expect(text).toMatch(PACKS_HEADER_RE);
  expect(text).toMatch(PACKS_DIR_RE);
  expect(text).toMatch(ENABLED_KOTLIN_BEST_PRACTICES_RE);
});

test("generateConfigToml: a rule whose tier differs from default_tier gets an active [rules.<id>] override", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [KOTLIN_PACK],
  });
  expect(text).toMatch(ASSERT_EQUALS_BOOLEAN_OVERRIDE_RE);
  // A rule matching the project default_tier gets no override line at all.
  expect(text).not.toMatch(FORCE_UNWRAP_RULE_TABLE_RE);
});

test("generateConfigToml: default_enabled=false rules are written commented-out with an explanatory line", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [OPINIONATED_PACK],
  });
  // The explanation names the rule, the owning pack, and the pack.yml summary.
  expect(text).toMatch(USECASE_COMPOSING_DISABLED_COMMENT_RE);
  expect(text).toMatch(OFF_BY_DEFAULT_SUMMARY_RE);
  // The actual TOML table is commented out, not active.
  expect(text).toMatch(USECASE_COMPOSING_COMMENTED_TABLE_RE);
  expect(text).toMatch(COMMENTED_ENABLED_TRUE_RE);
  expect(text).not.toMatch(USECASE_COMPOSING_ACTIVE_TABLE_RE);
  // A rule enabled by default and matching default_tier gets nothing at all.
  expect(text).not.toMatch(ALWAYS_ON_RULE_MENTION_RE);
});

test("generateConfigToml: is a pure function of its inputs (stable across repeated calls)", () => {
  const opts = {
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [KOTLIN_PACK, OPINIONATED_PACK],
  };
  expect(generateConfigToml(opts)).toBe(generateConfigToml(opts));
});

test("parseConfigToml: reads back languages, default_tier, packs_dir, and enabled", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [KOTLIN_PACK, OPINIONATED_PACK],
  });
  const parsed = parseConfigToml(text);
  expect(parsed.core).toEqual({ languages: ["kotlin"], defaultTier: "deny" });
  expect(parsed.packs.packsDir).toBe("packs");
  expect(parsed.packs.enabled).toEqual(["kotlin-best-practices", "android-opinionated"]);
});

test("generateConfigToml: throws instead of interpolating an unsafe rule id (defense in depth)", () => {
  const packWithUnsafeRule: PackMeta = {
    id: "kotlin-best-practices",
    title: "Kotlin Best Practices",
    language: "kotlin",
    dir: "/fake/packs/kotlin-best-practices",
    rules: [{ id: "../../../etc", tier: "deny", defaultEnabled: true, summary: "Traversal id." }],
  };
  expect(() =>
    generateConfigToml({
      languages: ["kotlin"],
      defaultTier: "deny",
      packsDir: "packs",
      enabledPacks: [packWithUnsafeRule],
    }),
  ).toThrow(/unsafe id/);
});

test("generateConfigToml: throws instead of interpolating an unsafe pack id (defense in depth)", () => {
  const unsafePack: PackMeta = {
    id: "../../evil",
    title: "Evil",
    language: "kotlin",
    dir: "/fake/packs/evil",
    rules: [{ id: "some-rule", tier: "autofix", defaultEnabled: true, summary: "Tier differs from default." }],
  };
  expect(() =>
    generateConfigToml({
      languages: ["kotlin"],
      defaultTier: "deny",
      packsDir: "packs",
      enabledPacks: [unsafePack],
    }),
  ).toThrow(/unsafe id/);
});

test("hasCoreAndPacksSections: true for a generated file, false for a file missing a section", () => {
  const full = generateConfigToml({ languages: ["kotlin"], defaultTier: "deny", packsDir: "packs", enabledPacks: [] });
  expect(hasCoreAndPacksSections(full)).toBe(true);
  expect(hasCoreAndPacksSections("[core]\nlanguages = []\n")).toBe(false);
  expect(hasCoreAndPacksSections("not toml at all")).toBe(false);
});
