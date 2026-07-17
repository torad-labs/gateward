/** Unit tests for ast-grep invocation failure detection.
 *
 * The critical subtlety these tests pin down: `ast-grep scan` exits NONZERO
 * when it *finds matches* — that is a normal, successful invocation, not a
 * failure — while a timeout-kill is a genuinely different, distinguishable
 * event. Verified empirically against Bun 1.3.14's `Bun.spawnSync`:
 *
 *   Bun.spawnSync({ cmd: ["sleep", "5"], timeout: 100 })
 *   -> { exitCode: null, signalCode: "SIGTERM", exitedDueToTimeout: true, ... }
 *
 *   Bun.spawnSync({ cmd: ["sh", "-c", "echo hi; exit 1"], timeout: 5000 })
 *   -> { exitCode: 1, signalCode: undefined, exitedDueToTimeout: false, ... }
 *
 * i.e. a completed-but-nonzero invocation has a numeric exitCode and
 * exitedDueToTimeout: false; only a kill (by the configured timeout, or any
 * other signal) leaves exitCode null. exec() keys its failure detection on
 * exactly that.
 *
 * `GATEWARD_AST_GREP_TIMEOUT_MS` (a test-only escape hatch alongside
 * the existing `GATEWARD_AST_GREP` binary override) lets these tests
 * force a real, fast timeout-kill instead of waiting on the 30s production
 * default.
 */
import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { find } from "../src/config";
import { AstGrepFailed, applyFix, exec, scan } from "../src/scan";

async function freshRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `core-scan-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${root}`.quiet();
  return root;
}

/** A minimal, valid project config with ONE enabled pack holding one rule —
 * enough that `scan()`/`applyFix()` reach `exec()`. (An empty enabled set is
 * a legitimate early "nothing to check" allow that never invokes ast-grep, so
 * these timeout tests must enable a real rule to drive the scanner path.) The
 * rule's content is irrelevant here: these tests fake the ast-grep binary
 * itself, which ignores the rules and just sleeps. */
async function minimalConfig(root: string) {
  const packs = path.join(root, "packs");
  await Bun.write(
    path.join(packs, "test-pack", "pack.yml"),
    "id: test-pack\nlanguage: kotlin\ntitle: Test Pack\nrules:\n  - id: no-bang-bang\n",
  );
  await Bun.write(
    path.join(packs, "test-pack", "rules", "no-bang-bang.yml"),
    "id: no-bang-bang\nlanguage: kotlin\nseverity: error\nmessage: banned\nrule:\n  pattern: $A!!\n",
  );
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "${packs}"
enabled = ["test-pack"]
`,
  );
  const config = await find(project);
  if (!config) throw new Error("config should resolve");
  return { project, config };
}

/** Writes an executable fake "ast-grep" that sleeps well past any short test
 * timeout, so exec() and its callers observe a real timeout-kill. */
async function writeSlowFakeBinary(root: string): Promise<string> {
  const script = path.join(root, "fake-ast-grep.sh");
  await Bun.write(script, "#!/bin/sh\nsleep 5\necho '[]'\n");
  await Bun.$`chmod +x ${script}`.quiet();
  return script;
}

/** Runs `fn` with the given env vars set, restoring the previous values
 * (or unsetting them) afterward — env vars are process-global. */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = Bun.env[key];
  Object.assign(Bun.env, vars);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      // biome-ignore lint/performance/noDelete: Bun.env stringifies assignments (`= undefined` sets the literal string "undefined"); delete is the only way to actually unset it
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
  }
}

test("exec() does not throw when ast-grep exits nonzero because it found matches", async () => {
  const root = await freshRoot();
  const tmpFile = path.join(root, "A.kt");
  await Bun.write(tmpFile, "val a = x!!\n");
  const rule = `id: no-bang-bang
language: kotlin
severity: error
message: Force-unwrap is banned.
rule:
  pattern: $A!!
`;
  const result = exec(["scan", "--inline-rules", rule, "--json=compact", tmpFile]);
  // ast-grep's own exit code for "matches found" is nonzero — confirm that
  // empirically here too, and confirm it does NOT throw.
  expect(result.exitCode).not.toBe(0);
  const matches = JSON.parse(result.stdout?.toString() || "[]");
  expect(matches.length).toBe(1);
});

test("exec() throws AstGrepFailed on a real timeout-kill, not a silent empty result", async () => {
  const root = await freshRoot();
  const slowBinary = await writeSlowFakeBinary(root);
  await withEnv({ GATEWARD_AST_GREP: slowBinary, GATEWARD_AST_GREP_TIMEOUT_MS: "100" }, () => {
    expect(() => exec(["scan", "--json=compact", "whatever"])).toThrow(AstGrepFailed);
  });
});

test("scan() throws AstGrepFailed on a nonzero exit with empty stdout (broken/invalid rules)", async () => {
  // Distinct from a timeout: ast-grep exits nonzero with NOTHING on stdout
  // (its error goes to stderr) when the rules don't parse. That must fail
  // closed, not read as "[]" → zero matches → allow.
  const root = await freshRoot();
  const brokenBinary = path.join(root, "broken-ast-grep.sh");
  await Bun.write(brokenBinary, "#!/bin/sh\necho 'YAML parse error' >&2\nexit 2\n");
  await Bun.$`chmod +x ${brokenBinary}`.quiet();
  const { project, config } = await minimalConfig(root);
  const filePath = path.join(project, "A.kt");
  await withEnv({ GATEWARD_AST_GREP: brokenBinary }, async () => {
    await expect(scan("val a = x!!\n", filePath, config)).rejects.toThrow(AstGrepFailed);
  });
});

test("scan() returns [] (allow) when no rules are enabled, without invoking ast-grep", async () => {
  // An empty enabled set is a legitimate "nothing to check" allow — and it
  // must NOT call ast-grep (an empty --inline-rules would itself error). The
  // fake binary here would throw if invoked; the test passing proves it isn't.
  const root = await freshRoot();
  const neverCalled = path.join(root, "must-not-run.sh");
  await Bun.write(neverCalled, "#!/bin/sh\nexit 3\n");
  await Bun.$`chmod +x ${neverCalled}`.quiet();
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]\nlanguages = ["kotlin"]\ndefault_tier = "deny"\n\n[packs]\npacks_dir = "${path.join(root, "packs")}"\nenabled = []\n`,
  );
  const config = await find(project);
  if (!config) throw new Error("config should resolve");
  await withEnv({ GATEWARD_AST_GREP: neverCalled }, async () => {
    expect(await scan("val a = x!!\n", path.join(project, "A.kt"), config)).toEqual([]);
  });
});

test("scan() propagates AstGrepFailed on a timeout instead of returning zero matches", async () => {
  const root = await freshRoot();
  const slowBinary = await writeSlowFakeBinary(root);
  const { project, config } = await minimalConfig(root);
  const filePath = path.join(project, "A.kt");
  await withEnv({ GATEWARD_AST_GREP: slowBinary, GATEWARD_AST_GREP_TIMEOUT_MS: "100" }, async () => {
    await expect(scan("val a = x!!\n", filePath, config)).rejects.toThrow(AstGrepFailed);
  });
});

test("applyFix() throws AstGrepFailed instead of returning unverified temp-file bytes", async () => {
  const root = await freshRoot();
  const slowBinary = await writeSlowFakeBinary(root);
  const { project, config } = await minimalConfig(root);
  const filePath = path.join(project, "A.kt");
  await withEnv({ GATEWARD_AST_GREP: slowBinary, GATEWARD_AST_GREP_TIMEOUT_MS: "100" }, async () => {
    await expect(applyFix("val a = x!!\n", filePath, config)).rejects.toThrow(AstGrepFailed);
  });
});

test("applyFix() still returns the rewritten file on a real, successful invocation", async () => {
  // minimalConfig's one rule (no-bang-bang) has no `fix:`, so a real
  // --update-all run completes and rewrites nothing — this confirms the happy
  // path (no throw, real ast-grep run to completion) round-trips content
  // unchanged, as a control against the fake-slow-binary failure tests above.
  const root = await freshRoot();
  const { project, config } = await minimalConfig(root);
  const filePath = path.join(project, "A.kt");
  const fixed = await applyFix("val a = x!!\n", filePath, config);
  expect(fixed).toBe("val a = x!!\n");
});
