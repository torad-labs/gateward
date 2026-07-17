import { expect, test } from "bun:test";
import type { PackMeta } from "../types";
import { generateConfigToml, hasCoreAndPacksSections, parseConfigToml } from "./tenetsConfig";

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
  expect(text).toMatch(/^\[core\]\n/);
  expect(text).toMatch(/languages = \["kotlin"\]/);
  expect(text).toMatch(/default_tier = "deny"/);
  expect(text).toMatch(/\[packs\]/);
  expect(text).toMatch(/packs_dir = "packs"/);
  expect(text).toMatch(/enabled = \["kotlin-best-practices"\]/);
});

test("generateConfigToml: a rule whose tier differs from default_tier gets an active [rules.<id>] override", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [KOTLIN_PACK],
  });
  expect(text).toMatch(/\n\[rules\.no-assert-equals-boolean\]\ntier = "autofix"\n/);
  // A rule matching the project default_tier gets no override line at all.
  expect(text).not.toMatch(/\[rules\.no-force-unwrap\]/);
});

test("generateConfigToml: default_enabled=false rules are written commented-out with an explanatory line", () => {
  const text = generateConfigToml({
    languages: ["kotlin"],
    defaultTier: "deny",
    packsDir: "packs",
    enabledPacks: [OPINIONATED_PACK],
  });
  // The explanation names the rule, the owning pack, and the pack.yml summary.
  expect(text).toMatch(/# no-usecase-composing-usecase: disabled by default in android-opinionated\./);
  expect(text).toMatch(/Off by default: house taste allows composition\./);
  // The actual TOML table is commented out, not active.
  expect(text).toMatch(/# \[rules\.no-usecase-composing-usecase\]/);
  expect(text).toMatch(/# enabled = true/);
  expect(text).not.toMatch(/^\[rules\.no-usecase-composing-usecase\]/m);
  // A rule enabled by default and matching default_tier gets nothing at all.
  expect(text).not.toMatch(/always-on-rule/);
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

test("hasCoreAndPacksSections: true for a generated file, false for a file missing a section", () => {
  const full = generateConfigToml({ languages: ["kotlin"], defaultTier: "deny", packsDir: "packs", enabledPacks: [] });
  expect(hasCoreAndPacksSections(full)).toBe(true);
  expect(hasCoreAndPacksSections("[core]\nlanguages = []\n")).toBe(false);
  expect(hasCoreAndPacksSections("not toml at all")).toBe(false);
});
