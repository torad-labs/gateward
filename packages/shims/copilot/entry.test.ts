/**
 * Unit tests for the GitHub Copilot preToolUse -> gateward shim.
 *
 * Payload normalization, arg mapping, and verdict translation are tested
 * with the core invocation injected (no subprocess); `evaluate()` is
 * additionally tested for real against the actual core entrypoint and a
 * live ast-grep, to prove the whole chain wires together correctly and not
 * just when stubbed.
 */

import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { evaluate } from "./entry";

const REPO = path.resolve(import.meta.dir, "..", "..", "..");
const PACKS = path.join(REPO, "packs");

const CONFIG_TOML = `[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "${PACKS}"
enabled = ["kotlin-best-practices"]
`;

async function freshWorkspace(): Promise<string> {
  const workspace = path.join(os.tmpdir(), `copilot-shim-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${workspace}`.quiet();
  return workspace;
}

async function writeTenets(projectRoot: string): Promise<void> {
  await Bun.write(path.join(projectRoot, ".tenets", "config.toml"), CONFIG_TOML);
}

const decisionOf = (result: Record<string, unknown> | null) => result?.permissionDecision;
const reasonOf = (result: Record<string, unknown> | null) => result?.permissionDecisionReason as string | undefined;

const allowCore = async (): Promise<[string, unknown]> => ["allow", null];
const denyCore = async (): Promise<[string, unknown]> => ["deny", "[no-force-unwrap] line 1: banned"];

// --- tool gating ---

test("evaluate: a non-file tool is not ours — silent allow", async () => {
  const result = await evaluate(
    { toolName: "bash", toolArgs: { command: "ls" } },
    {
      invokeCore: async (): Promise<[string, unknown]> => {
        throw new Error("invokeCore must not be called for a non-file tool");
      },
    },
  );
  expect(result).toBeNull();
});

test("evaluate: an unreadable payload denies (matcher-scoped: every call is a file tool)", async () => {
  expect(decisionOf(await evaluate("garbage", { invokeCore: allowCore }))).toBe("deny");
  expect(decisionOf(await evaluate(null, { invokeCore: allowCore }))).toBe("deny");
});

// --- arg mapping: create/write shapes ---

test("evaluate: create with filePath+content maps to a Claude Write", async () => {
  let seen: unknown;
  const result = await evaluate(
    { toolName: "create", toolArgs: { filePath: "/tmp/A.kt", content: "val a = 1\n" } },
    {
      invokeCore: async (mapped): Promise<[string, unknown]> => {
        seen = mapped;
        return ["allow", null];
      },
    },
  );
  expect(result).toBeNull();
  expect(seen).toEqual({
    name: "Write",
    input: { file_path: "/tmp/A.kt", content: "val a = 1\n" },
    writeBackKey: "content",
  });
});

test("evaluate: snake_case compat payload (tool_name/tool_input, file_path) maps too", async () => {
  let seen: unknown;
  await evaluate(
    { tool_name: "Write", tool_input: { file_path: "/tmp/B.kt", content: "val b = 1\n" } },
    {
      invokeCore: async (mapped): Promise<[string, unknown]> => {
        seen = mapped;
        return ["allow", null];
      },
    },
  );
  expect((seen as { name: string }).name).toBe("Write");
  expect((seen as { input: { file_path: string } }).input.file_path).toBe("/tmp/B.kt");
});

test("evaluate: toolArgs as a JSON-encoded string (Copilot's documented test shape) decodes", async () => {
  let seen: unknown;
  await evaluate(
    { toolName: "create", toolArgs: JSON.stringify({ filePath: "/tmp/C.kt", content: "val c = 1\n" }) },
    {
      invokeCore: async (mapped): Promise<[string, unknown]> => {
        seen = mapped;
        return ["allow", null];
      },
    },
  );
  expect((seen as { input: { content: string } }).input.content).toBe("val c = 1\n");
});

// --- arg mapping: edit shapes ---

test("evaluate: edit with oldString/newString maps to a Claude Edit", async () => {
  let seen: unknown;
  await evaluate(
    { toolName: "edit", toolArgs: { filePath: "/tmp/D.kt", oldString: "val d = 1", newString: "val d = 2" } },
    {
      invokeCore: async (mapped): Promise<[string, unknown]> => {
        seen = mapped;
        return ["allow", null];
      },
    },
  );
  expect(seen).toEqual({
    name: "Edit",
    input: { file_path: "/tmp/D.kt", old_string: "val d = 1", new_string: "val d = 2" },
    writeBackKey: "newString",
  });
});

test("evaluate: edit with old_str and no new-side key maps to a deletion Edit", async () => {
  let seen: unknown;
  await evaluate(
    { toolName: "edit", toolArgs: { path: "/tmp/E.kt", old_str: "val gone = 1" } },
    {
      invokeCore: async (mapped): Promise<[string, unknown]> => {
        seen = mapped;
        return ["allow", null];
      },
    },
  );
  expect(seen).toEqual({
    name: "Edit",
    input: { file_path: "/tmp/E.kt", old_string: "val gone = 1", new_string: "" },
    writeBackKey: "new_str",
  });
});

// --- fail-closed paths ---

test("evaluate: a gated tool with unmappable args denies and names the keys that arrived", async () => {
  const result = await evaluate(
    { toolName: "edit", toolArgs: { somethingElse: true, whatever: "x" } },
    { invokeCore: allowCore },
  );
  expect(decisionOf(result)).toBe("deny");
  expect(reasonOf(result)).toContain("somethingElse");
  expect(reasonOf(result)).toContain("whatever");
});

test("evaluate: a gated tool with undecodable string args denies", async () => {
  const result = await evaluate({ toolName: "create", toolArgs: "not json at all" }, { invokeCore: allowCore });
  expect(decisionOf(result)).toBe("deny");
});

test("evaluate: a gated tool with missing args denies", async () => {
  expect(decisionOf(await evaluate({ toolName: "create" }, { invokeCore: allowCore }))).toBe("deny");
});

// --- verdict translation ---

test("evaluate: a core deny becomes a flat Copilot deny with the same reason", async () => {
  const result = await evaluate(
    { toolName: "create", toolArgs: { filePath: "/tmp/F.kt", content: "val f = x!!\n" } },
    { invokeCore: denyCore },
  );
  expect(decisionOf(result)).toBe("deny");
  expect(reasonOf(result)).toBe("[no-force-unwrap] line 1: banned");
  expect(result).not.toHaveProperty("hookSpecificOutput");
});

test("evaluate: a core autofix becomes allow + modifiedArgs under the original key spelling", async () => {
  const result = await evaluate(
    { toolName: "edit", toolArgs: { filePath: "/tmp/G.kt", oldStr: "assertEquals(true, x)", newStr: "bad" } },
    {
      invokeCore: async (): Promise<[string, unknown]> => [
        "autofix",
        { file_path: "/tmp/G.kt", old_string: "assertEquals(true, x)", new_string: "assertTrue(x)" },
      ],
    },
  );
  expect(decisionOf(result)).toBe("allow");
  const modified = result?.modifiedArgs as Record<string, unknown>;
  expect(modified.newStr).toBe("assertTrue(x)");
  expect(modified.oldStr).toBe("assertEquals(true, x)");
  expect(modified.filePath).toBe("/tmp/G.kt");
});

test("evaluate: an autofix verdict without the rewritten content denies rather than allowing", async () => {
  const result = await evaluate(
    { toolName: "create", toolArgs: { filePath: "/tmp/H.kt", content: "x" } },
    { invokeCore: async (): Promise<[string, unknown]> => ["autofix", {}] },
  );
  expect(decisionOf(result)).toBe("deny");
});

// --- evaluate() against the real core + real ast-grep ---

test("evaluate: a create introducing a force-unwrap denies for real", async () => {
  const workspace = await freshWorkspace();
  await writeTenets(workspace);
  const target = path.join(workspace, "Real.kt");

  const result = await evaluate({
    toolName: "create",
    toolArgs: { filePath: target, content: "package com.example\n\nval unsafe = maybeNull!!\n" },
  });

  expect(decisionOf(result)).toBe("deny");
  expect(reasonOf(result)).toContain("no-force-unwrap");
});

test("evaluate: a clean create allows for real", async () => {
  const workspace = await freshWorkspace();
  await writeTenets(workspace);
  const target = path.join(workspace, "RealClean.kt");

  const result = await evaluate({
    toolName: "create",
    toolArgs: { filePath: target, content: "package com.example\n\nval safe = 1\n" },
  });

  expect(result).toBeNull();
});
