import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { parsePackYaml, listPacks } from "./packYaml";

const FIXTURE = `# Pack manifest comment, should be ignored.
id: sample-pack
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

test("parsePackYaml: top-level id/title", () => {
  const meta = parsePackYaml(FIXTURE, "/fake/dir");
  assert.equal(meta.id, "sample-pack");
  assert.equal(meta.title, "Sample Pack");
  assert.equal(meta.dir, "/fake/dir");
});

test("parsePackYaml: plain single-line summary and default tier/enabled", () => {
  const meta = parsePackYaml(FIXTURE, "/fake/dir");
  const rule = meta.rules.find((r) => r.id === "rule-plain");
  assert.ok(rule);
  assert.equal(rule.tier, "deny");
  assert.equal(rule.defaultEnabled, true);
  assert.equal(rule.summary, "A single-line summary.");
});

test("parsePackYaml: folded (>-) summary is joined across lines with a single space", () => {
  const meta = parsePackYaml(FIXTURE, "/fake/dir");
  const rule = meta.rules.find((r) => r.id === "rule-off-by-default");
  assert.ok(rule);
  assert.equal(rule.defaultEnabled, false);
  assert.equal(
    rule.summary,
    "Off by default: a folded summary that spans two physical lines and should be joined with one space.",
  );
});

test("parsePackYaml: quoted summary strips surrounding quotes and preserves inner ellipsis", () => {
  const meta = parsePackYaml(FIXTURE, "/fake/dir");
  const rule = meta.rules.find((r) => r.id === "rule-autofix");
  assert.ok(rule);
  assert.equal(rule.tier, "autofix");
  assert.equal(rule.defaultEnabled, true);
  assert.equal(rule.summary, "A quoted summary with ... ellipsis inside.");
});

test("parsePackYaml: missing top-level id throws", () => {
  assert.throws(() => parsePackYaml("title: No Id\nrules:\n", "/fake/dir"));
});

test("listPacks: enumerates only directories containing a pack.yml, sorted by directory name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "packyaml-test-"));
  try {
    fs.mkdirSync(path.join(root, "zeta-pack"));
    fs.writeFileSync(path.join(root, "zeta-pack", "pack.yml"), "id: zeta\ntitle: Zeta\nrules:\n");
    fs.mkdirSync(path.join(root, "alpha-pack"));
    fs.writeFileSync(path.join(root, "alpha-pack", "pack.yml"), "id: alpha\ntitle: Alpha\nrules:\n");
    fs.mkdirSync(path.join(root, "no-manifest-here"));

    const packs = listPacks(root);
    assert.deepEqual(
      packs.map((p) => p.id),
      ["alpha", "zeta"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listPacks: missing root returns an empty list", () => {
  assert.deepEqual(listPacks("/definitely/does/not/exist/anywhere"), []);
});
