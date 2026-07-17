import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listPacks, parsePackYaml } from "./packs";

const MENTIONS_LANGUAGE_RE = /language/;

const FIXTURE = `# Pack manifest comment, should be ignored.
id: sample-pack
language: typescript
title: Sample Pack
description: >-
  A folded description that should be skipped entirely, spanning several
  lines, none of which should leak into the parsed rules.
rules:
  - id: rule-plain
    tier: deny
    summary: A single-line summary.
  - id: rule-off-by-default
    tier: deny
    default_enabled: false
    summary: >-
      Off by default: a folded summary that spans two
      physical lines and should be joined with one space.
  - id: rule-autofix
    tier: autofix
    default_enabled: true
    summary: "A quoted summary with ... ellipsis inside."
`;

test("parsePackYaml: top-level id/title/language", () => {
  const meta = parsePackYaml(FIXTURE, "/fake/dir");
  expect(meta.id).toBe("sample-pack");
  expect(meta.title).toBe("Sample Pack");
  expect(meta.language).toBe("typescript");
  expect(meta.dir).toBe("/fake/dir");
});

test("parsePackYaml: missing top-level language throws", () => {
  expect(() => parsePackYaml("id: no-language\ntitle: No Language\nrules:\n", "/fake/dir")).toThrow(
    MENTIONS_LANGUAGE_RE,
  );
});

test("parsePackYaml: plain single-line summary and default tier/enabled", () => {
  const meta = parsePackYaml(FIXTURE, "/fake/dir");
  const rule = meta.rules.find((r) => r.id === "rule-plain");
  if (!rule) throw new Error("rule-plain not found");
  expect(rule.tier).toBe("deny");
  expect(rule.defaultEnabled).toBe(true);
  expect(rule.summary).toBe("A single-line summary.");
});

test("parsePackYaml: folded (>-) summary is joined across lines with a single space", () => {
  const meta = parsePackYaml(FIXTURE, "/fake/dir");
  const rule = meta.rules.find((r) => r.id === "rule-off-by-default");
  if (!rule) throw new Error("rule-off-by-default not found");
  expect(rule.defaultEnabled).toBe(false);
  expect(rule.summary).toBe(
    "Off by default: a folded summary that spans two physical lines and should be joined with one space.",
  );
});

test("parsePackYaml: quoted summary strips surrounding quotes and preserves inner ellipsis", () => {
  const meta = parsePackYaml(FIXTURE, "/fake/dir");
  const rule = meta.rules.find((r) => r.id === "rule-autofix");
  if (!rule) throw new Error("rule-autofix not found");
  expect(rule.tier).toBe("autofix");
  expect(rule.defaultEnabled).toBe(true);
  expect(rule.summary).toBe("A quoted summary with ... ellipsis inside.");
});

test("parsePackYaml: missing top-level id throws", () => {
  expect(() => parsePackYaml("title: No Id\nrules:\n", "/fake/dir")).toThrow();
});

test("listPacks: enumerates only directories containing a pack.yml, sorted by directory name", async () => {
  const root = path.join(os.tmpdir(), `packyaml-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${root}`.quiet();
  try {
    fs.mkdirSync(path.join(root, "zeta-pack"));
    await Bun.write(path.join(root, "zeta-pack", "pack.yml"), "id: zeta\nlanguage: kotlin\ntitle: Zeta\nrules:\n");
    fs.mkdirSync(path.join(root, "alpha-pack"));
    await Bun.write(path.join(root, "alpha-pack", "pack.yml"), "id: alpha\nlanguage: kotlin\ntitle: Alpha\nrules:\n");
    fs.mkdirSync(path.join(root, "no-manifest-here"));

    const packs = await listPacks(root);
    expect(packs.map((p) => p.id)).toEqual(["alpha", "zeta"]);
  } finally {
    await Bun.$`rm -rf ${root}`.quiet();
  }
});

test("listPacks: missing root returns an empty list", async () => {
  expect(await listPacks("/definitely/does/not/exist/anywhere")).toEqual([]);
});
