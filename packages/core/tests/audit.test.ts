/** Unit tests for the canonical audit: rule-id parsing, gated-file walking,
 * per-rule tallying with non-authored ids excluded, render formats, and the
 * always-exit-0 contract. Fresh unique temp trees per test (TOML import
 * caches per path). */

import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { authoredRuleIds, gatedFiles, renderHuman, renderJson, runAudit } from "../src/audit";
import { find } from "../src/config";
import type { Match } from "../src/scan";

const PACK_YML = `id: sample-pack
title: Sample Pack
description: Fixture pack for audit tests.
rules:
  - id: no-bang-bang
    tier: deny
    summary: Force-unwrap is banned.
`;

const RULE_YML = `id: no-bang-bang
language: kotlin
severity: error
message: Force-unwrap is banned.
metadata:
  tier: deny
rule:
  pattern: $A!!
`;

const DOMAIN_PACK_YML = `id: domain-pack
title: Domain Pack
description: "Fixture pack for rule-level files: glob-scoping tests."
rules:
  - id: domain-only-bang
    tier: deny
    summary: Force-unwrap is banned, but only under a domain/ directory.
`;

const DOMAIN_RULE_YML = `id: domain-only-bang
language: kotlin
severity: error
message: Force-unwrap is banned in domain code.
metadata:
  tier: deny
files:
  - '**/domain/**'
rule:
  pattern: $A!!
`;

async function freshRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `core-audit-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${root}`.quiet();
  return root;
}

async function writePack(root: string): Promise<string> {
  await Bun.write(path.join(root, "packs", "sample-pack", "pack.yml"), PACK_YML);
  await Bun.write(path.join(root, "packs", "sample-pack", "rules", "no-bang-bang.yml"), RULE_YML);
  return path.join(root, "packs");
}

async function writeDomainPack(root: string): Promise<string> {
  await Bun.write(path.join(root, "packs", "domain-pack", "pack.yml"), DOMAIN_PACK_YML);
  await Bun.write(path.join(root, "packs", "domain-pack", "rules", "domain-only-bang.yml"), DOMAIN_RULE_YML);
  return path.join(root, "packs");
}

async function writeProject(root: string, packsDir: string, enabled = "sample-pack"): Promise<string> {
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "${packsDir}"
enabled = ["${enabled}"]
`,
  );
  return project;
}

async function resolvedConfig(project: string) {
  const config = await find(project);
  if (!config) throw new Error("config should resolve");
  return config;
}

test("authoredRuleIds reads ids from enabled pack rule files", async () => {
  const root = await freshRoot();
  const project = await writeProject(root, await writePack(root));
  const config = await resolvedConfig(project);
  expect(await authoredRuleIds(config)).toEqual(new Set(["no-bang-bang"]));
});

test("gatedFiles skips build/.git/.gradle/node_modules at any depth and non-gated extensions", async () => {
  const root = await freshRoot();
  const project = await writeProject(root, await writePack(root));
  await Bun.write(path.join(project, "Keep.kt"), "val x = 1");
  await Bun.write(path.join(project, "Ignore.txt"), "not kotlin");
  await Bun.write(path.join(project, ".git", "Hidden.kt"), "val hidden = 1");
  await Bun.write(path.join(project, ".gradle", "Hidden.kt"), "val hidden = 1");
  await Bun.write(path.join(project, "app", "build", "Hidden.kt"), "val hidden = 1");
  await Bun.write(path.join(project, "node_modules", "dep", "types.kt"), "val hidden = 1");
  await Bun.write(path.join(project, "src", "main", "Deep.kt"), "val deep = 1");

  const config = await resolvedConfig(project);
  const found = await gatedFiles(project, config);
  expect(found.map((p) => path.basename(p)).sort()).toEqual(["Deep.kt", "Keep.kt"]);
});

test("node_modules exclusion also protects vendored .d.ts when typescript is gated", async () => {
  const root = await freshRoot();
  const packsDir = await writePack(root);
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]
languages = ["typescript"]
default_tier = "deny"

[packs]
packs_dir = "${packsDir}"
enabled = ["sample-pack"]
`,
  );
  await Bun.write(path.join(project, "src", "index.ts"), "export {};\n");
  await Bun.write(path.join(project, "node_modules", "typescript", "lib", "lib.dom.d.ts"), "interface X {}\n");

  const config = await resolvedConfig(project);
  const found = await gatedFiles(project, config);
  expect(found.map((p) => path.basename(p))).toEqual(["index.ts"]);
});

test("runAudit counts real violations via real ast-grep", async () => {
  const root = await freshRoot();
  const project = await writeProject(root, await writePack(root));
  await Bun.write(path.join(project, "A.kt"), "val a = x!!\nval b = y!!\n");
  await Bun.write(path.join(project, "B.kt"), "val clean = 1\n");

  const { perRule, total, filesScanned } = await runAudit(project);

  expect(perRule.get("no-bang-bang")).toBe(2);
  expect(perRule.size).toBe(1);
  expect(total).toBe(2);
  expect(filesScanned).toBe(2);
});

test("no .tenets config reports all zero", async () => {
  const emptyRoot = await freshRoot();
  const { perRule, total, filesScanned } = await runAudit(emptyRoot);
  expect(perRule.size).toBe(0);
  expect(total).toBe(0);
  expect(filesScanned).toBe(0);
});

test("matches outside the authored set are dropped (unused-suppression shape)", async () => {
  const root = await freshRoot();
  const project = await writeProject(root, await writePack(root));
  await Bun.write(path.join(project, "A.kt"), "val a = x!!\n");

  const fakeScanFile = async (): Promise<Match[]> => [
    { ruleId: "no-bang-bang", message: "m", text: "x!!", severity: "error", line: 1, tier: "deny" },
    {
      ruleId: "unused-suppression",
      message: "Unused directive.",
      text: "// ast-grep-ignore",
      severity: "hint",
      line: 2,
      tier: "deny",
    },
  ];

  const { perRule, total, filesScanned } = await runAudit(project, { scanFile: fakeScanFile });

  expect(perRule.get("no-bang-bang")).toBe(1);
  expect(perRule.has("unused-suppression")).toBe(false);
  expect(total).toBe(1);
  expect(filesScanned).toBe(1);
});

/** Locks in the fix at the heart of this module: scan()'s temp-file
 * invocation drops a file's real path (keeping only its project-relative
 * shape), so a rule's `files: ['**\/domain\/**']` matches only through the
 * audit's real-path scanning. */
test("files: globs are respected via real paths — domain dir counted, sibling not", async () => {
  const root = await freshRoot();
  const project = await writeProject(root, await writeDomainPack(root), "domain-pack");
  await Bun.write(path.join(project, "feature", "domain", "InDomain.kt"), "val a = x!!\n");
  await Bun.write(path.join(project, "feature", "presentation", "NotDomain.kt"), "val b = y!!\n");

  const { perRule, total, filesScanned } = await runAudit(project);

  expect(perRule.get("domain-only-bang")).toBe(1);
  expect(perRule.size).toBe(1);
  expect(total).toBe(1);
  expect(filesScanned).toBe(2);
});

test("a missing ast-grep binary stops scanning without throwing", async () => {
  const root = await freshRoot();
  const project = await writeProject(root, await writePack(root));
  await Bun.write(path.join(project, "A.kt"), "val a = x!!\n");

  const previous = Bun.env.PORTABLE_HOOKS_AST_GREP;
  Bun.env.PORTABLE_HOOKS_AST_GREP = "definitely-not-a-real-ast-grep-binary";
  try {
    const { perRule, total, filesScanned } = await runAudit(project);
    expect(perRule.size).toBe(0);
    expect(total).toBe(0);
    expect(filesScanned).toBe(0);
  } finally {
    if (previous === undefined) delete Bun.env.PORTABLE_HOOKS_AST_GREP;
    else Bun.env.PORTABLE_HOOKS_AST_GREP = previous;
  }
});

test("render_json has exactly three keys", () => {
  const payload = renderJson({ perRule: new Map([["rule-a", 2]]), total: 2, filesScanned: 5 });
  const data = JSON.parse(payload);
  expect(Object.keys(data).sort()).toEqual(["files_scanned", "per_rule", "total"]);
  expect(data.total).toBe(2);
  expect(data.per_rule).toEqual({ "rule-a": 2 });
  expect(data.files_scanned).toBe(5);
});

test("human table lists rule and totals", () => {
  const text = renderHuman({ perRule: new Map([["rule-a", 2]]), total: 2, filesScanned: 5 });
  expect(text).toContain("rule-a");
  expect(text).toContain("files scanned: 5");
  expect(text).toContain("total violations: 2");
});

test("empty per-rule still renders", () => {
  const text = renderHuman({ perRule: new Map(), total: 0, filesScanned: 0 });
  expect(text).toContain("files scanned: 0");
  expect(text).toContain("total violations: 0");
});

test("the audit CLI always exits zero, with violations and without", async () => {
  const root = await freshRoot();
  const project = await writeProject(root, await writePack(root));
  await Bun.write(path.join(project, "A.kt"), "val a = x!!\n");
  const auditCli = path.resolve(import.meta.dir, "..", "src", "audit.ts");

  const withViolations = Bun.spawnSync({ cmd: [process.execPath, auditCli, project] });
  expect(withViolations.exitCode).toBe(0);

  const jsonMode = Bun.spawnSync({ cmd: [process.execPath, auditCli, project, "--json"] });
  expect(jsonMode.exitCode).toBe(0);
  expect(JSON.parse(jsonMode.stdout.toString()).total).toBe(1);

  const emptyRoot = await freshRoot();
  const noTenets = Bun.spawnSync({ cmd: [process.execPath, auditCli, emptyRoot] });
  expect(noTenets.exitCode).toBe(0);
});
