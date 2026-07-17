/** Unit and process-level tests for the PreToolUse fail-closed contract.
 *
 * Two layers:
 *  - `evaluate()` unit tests for the file_path type-validation guard (a
 *    malformed, present-but-non-string file_path must deny, not crash on
 *    path.resolve/path.extname downstream).
 *  - `main()` process-level tests (spawning the real script) for the
 *    top-level error wrapper: any unexpected throw — a config that fails to
 *    load, a scanner that fails to run — must surface as a deny verdict on
 *    stdout, never an uncaught crash. Claude Code treats a non-0/non-2 exit
 *    as *non-blocking*, so a crash here would be fail-open; these tests pin
 *    that it isn't.
 */
import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { evaluate, type PreToolUsePayload } from "../src/events/pretooluse";

async function freshRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `core-pretooluse-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${root}`.quiet();
  return root;
}

async function writeValidProject(root: string): Promise<string> {
  // One enabled pack with one rule, so the scan path actually invokes the
  // (faked) scanner. An empty enabled set is a legitimate early allow that
  // never calls ast-grep — no scanner to time out — so the timeout test needs
  // a real enabled rule to reach it.
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
  return project;
}

/** Payloads arrive as unvalidated JSON on stdin in production; round-tripping
 * through JSON.parse here (rather than constructing a typed object with an
 * `as any` field) exercises the exact same "any" shape evaluate() must
 * defend against. */
function payloadFrom(json: string): PreToolUsePayload {
  return JSON.parse(json) as PreToolUsePayload;
}

test("Write with a non-string file_path denies (malformed payload, fail closed)", async () => {
  // The type check happens before config.find() is ever called, so no
  // .tenets/ project fixture is needed here — the malformed shape alone
  // must be enough to deny.
  const payload = payloadFrom(
    JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: 123, content: "val x = 1\n" },
    }),
  );
  const result = await evaluate(payload);
  expect(result).not.toBeNull();
  expect(result?.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("Edit with a non-string file_path denies (malformed payload, fail closed)", async () => {
  const payload = payloadFrom(
    JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: { nested: "object" }, old_string: "a", new_string: "b" },
    }),
  );
  const result = await evaluate(payload);
  expect(result).not.toBeNull();
  expect(result?.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("a null file_path denies too (present, just not a string)", async () => {
  const payload = payloadFrom(JSON.stringify({ tool_name: "Write", tool_input: { file_path: null, content: "x" } }));
  const result = await evaluate(payload);
  expect(result).not.toBeNull();
  expect(result?.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("Write with an absent file_path still allows (not actionable, unchanged behavior)", async () => {
  const payload = payloadFrom(JSON.stringify({ tool_name: "Write", tool_input: { content: "x" } }));
  expect(await evaluate(payload)).toBeNull();
});

test("Write with an empty-string file_path still allows (unchanged behavior)", async () => {
  const payload = payloadFrom(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "", content: "x" } }));
  expect(await evaluate(payload)).toBeNull();
});

test("Write with a non-string content denies (malformed payload, fail closed)", async () => {
  const payload = payloadFrom(
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/tmp/x.kt", content: 123 } }),
  );
  const result = await evaluate(payload);
  expect(result?.hookSpecificOutput.permissionDecision).toBe("deny");
});

/** A project enabling one real rule, whose tier can be overridden. Uses the
 * real ast-grep binary (installed in CI/dev), not a fake. */
async function projectWithRule(root: string, ruleTierOverride = ""): Promise<string> {
  const packs = path.join(root, "packs");
  await Bun.write(
    path.join(packs, "kt", "pack.yml"),
    "id: kt\nlanguage: kotlin\ntitle: KT\nrules:\n  - id: no-bang-bang\n",
  );
  // no-bang-bang has NO `fix:` — forcing it to autofix tier exercises the
  // "autofix rule that can't actually fix" path.
  await Bun.write(
    path.join(packs, "kt", "rules", "no-bang-bang.yml"),
    "id: no-bang-bang\nlanguage: kotlin\nseverity: error\nmessage: banned\nrule:\n  pattern: $A!!\n",
  );
  const project = path.join(root, "project");
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]\nlanguages = ["kotlin"]\ndefault_tier = "deny"\n\n[packs]\npacks_dir = "${packs}"\nenabled = ["kt"]\n${ruleTierOverride}`,
  );
  return project;
}

test("autofix-tier rule with no fix: denies (does not allow the violation unchanged)", async () => {
  // Finding #2: a rule marked autofix but lacking a fix: rewrites nothing.
  // Re-scanning the "fixed" content still finds the violation → deny, never
  // an allow carrying the still-dirty content.
  const root = await freshRoot();
  const project = await projectWithRule(root, '[rules.no-bang-bang]\ntier = "autofix"\n');
  const payload = {
    tool_name: "Write",
    tool_input: { file_path: path.join(project, "A.kt"), content: "fun f() { val x = y!! }\n" },
  };
  const result = await evaluate(payloadFrom(JSON.stringify(payload)));
  expect(result?.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("extension gating is case-insensitive: a violating .KT write denies (finding #7)", async () => {
  const root = await freshRoot();
  const project = await projectWithRule(root);
  const payload = {
    tool_name: "Write",
    tool_input: { file_path: path.join(project, "Upper.KT"), content: "fun f() { val x = y!! }\n" },
  };
  const result = await evaluate(payloadFrom(JSON.stringify(payload)));
  expect(result?.hookSpecificOutput.permissionDecision).toBe("deny");
});

/** Spawns the real hook script and feeds it `payload` on stdin, optionally
 * with extra env vars (used to force a fast fake ast-grep timeout). */
function runHook(payload: unknown, env: Record<string, string> = {}): { stdout: string; exitCode: number | null } {
  const hookPath = path.resolve(import.meta.dir, "..", "src", "events", "pretooluse.ts");
  const result = Bun.spawnSync({
    cmd: [process.execPath, hookPath],
    stdin: Buffer.from(JSON.stringify(payload)),
    env: { ...Bun.env, ...env },
  });
  return { stdout: result.stdout.toString(), exitCode: result.exitCode };
}

test("a malformed config.toml denies via main()'s wrapper instead of crashing", async () => {
  const root = await freshRoot();
  const project = path.join(root, "project");
  // `languages = "kotlin"` — a bracket-typo valid TOML scalar, invalid schema
  // (finding #7). config.find() throws; nothing in evaluate() catches a
  // config-load error, so this exercises main()'s top-level wrapper.
  await Bun.write(
    path.join(project, ".tenets", "config.toml"),
    `[core]
languages = "kotlin"
default_tier = "deny"
`,
  );
  const payload = {
    tool_name: "Write",
    tool_input: { file_path: path.join(project, "New.kt"), content: "val x = 1\n" },
  };

  const { stdout, exitCode } = runHook(payload);

  expect(exitCode).toBe(0); // never crashes the process
  const verdict = JSON.parse(stdout);
  expect(verdict.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("a scanner that times out denies instead of returning an empty (allow) scan", async () => {
  const root = await freshRoot();
  const project = await writeValidProject(root);
  const slowBinary = path.join(root, "fake-ast-grep.sh");
  await Bun.write(slowBinary, "#!/bin/sh\nsleep 5\necho '[]'\n");
  await Bun.$`chmod +x ${slowBinary}`.quiet();

  const payload = {
    tool_name: "Write",
    tool_input: { file_path: path.join(project, "New.kt"), content: "val x = 1\n" },
  };

  const { stdout, exitCode } = runHook(payload, {
    GATEWARD_AST_GREP: slowBinary,
    GATEWARD_AST_GREP_TIMEOUT_MS: "100",
  });

  expect(exitCode).toBe(0); // never crashes the process
  const verdict = JSON.parse(stdout);
  expect(verdict.hookSpecificOutput.permissionDecision).toBe("deny");
});
