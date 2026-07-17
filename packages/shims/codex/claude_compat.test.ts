/**
 * Unit tests for the Codex apply_patch -> Claude Code compat shim.
 *
 * Envelope parsing, hunk application, and verdict merging are tested as pure
 * logic (no subprocess). `evaluate()` is additionally tested end-to-end
 * twice: once with the core invocation injected (a 3-file batch, and a
 * malformed envelope), and once for real against the actual core entrypoint
 * and a live ast-grep, to prove the whole chain — envelope parse, hunk
 * projection, per-file subprocess judging, merge — wires together correctly
 * and not just when stubbed.
 */

import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { applyHunks, evaluate, extractPatchText, merge, parseApplyPatch } from "./claude_compat";

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
  const workspace = path.join(os.tmpdir(), `codex-shim-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${workspace}`.quiet();
  return workspace;
}

async function writeTenets(projectRoot: string): Promise<void> {
  await Bun.write(path.join(projectRoot, ".tenets", "config.toml"), CONFIG_TOML);
}

interface Verdict {
  hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
}

const reasonOf = (result: Record<string, unknown> | null) =>
  (result as Verdict | null)?.hookSpecificOutput.permissionDecisionReason;

// --- patch text extraction ---

test("extractPatchText: plain string command", () => {
  const payload = { tool_input: { command: "*** Begin Patch\n*** End Patch\n" } };
  expect(extractPatchText(payload)).toBe("*** Begin Patch\n*** End Patch\n");
});

test("extractPatchText: shell-array invocation form", () => {
  const payload = { tool_input: { command: ["apply_patch", "*** Begin Patch\n*** End Patch\n"] } };
  expect(extractPatchText(payload)).toBe("*** Begin Patch\n*** End Patch\n");
});

test("extractPatchText: tool_input as raw string", () => {
  const payload = { tool_input: "*** Begin Patch\n*** End Patch\n" };
  expect(extractPatchText(payload)).toBe("*** Begin Patch\n*** End Patch\n");
});

test("extractPatchText: command without patch marker is not ours", () => {
  expect(extractPatchText({ tool_input: { command: "ls -la" } })).toBe("");
});

test("extractPatchText: missing tool_input", () => {
  expect(extractPatchText({})).toBe("");
});

test("extractPatchText: shell array with no patch element", () => {
  expect(extractPatchText({ tool_input: { command: ["ls", "-la"] } })).toBe("");
});

// --- envelope parsing ---

test("parseApplyPatch: Add File collects full content", () => {
  const text = "*** Begin Patch\n*** Add File: New.kt\n+package com.example\n+\n+val x = 1\n*** End Patch\n";
  const files = parseApplyPatch(text);
  expect(files.length).toBe(1);
  expect(files[0].kind).toBe("Add");
  expect(files[0].path).toBe("New.kt");
  expect(files[0].newLines).toEqual(["package com.example", "", "val x = 1"]);
});

test("parseApplyPatch: Update File collects one hunk", () => {
  const text =
    "*** Begin Patch\n*** Update File: Existing.kt\n@@\n package com.example\n-val old = 1\n+val new = 2\n*** End Patch\n";
  const files = parseApplyPatch(text);
  expect(files.length).toBe(1);
  expect(files[0].kind).toBe("Update");
  expect(files[0].hunks.length).toBe(1);
  expect(files[0].hunks[0].oldLines).toEqual(["package com.example", "val old = 1"]);
  expect(files[0].hunks[0].newLines).toEqual(["package com.example", "val new = 2"]);
});

test("parseApplyPatch: Delete File", () => {
  const files = parseApplyPatch("*** Begin Patch\n*** Delete File: Gone.kt\n*** End Patch\n");
  expect(files.length).toBe(1);
  expect(files[0].kind).toBe("Delete");
  expect(files[0].path).toBe("Gone.kt");
});

test("parseApplyPatch: three-file batch parses all three in order", () => {
  const text =
    "*** Begin Patch\n*** Add File: A.kt\n+val a = 1\n*** Update File: B.kt\n@@\n val b = 1\n-val old = 1\n+val new = 2\n*** Delete File: C.kt\n*** End Patch\n";
  const files = parseApplyPatch(text);
  expect(files.map((f) => f.kind)).toEqual(["Add", "Update", "Delete"]);
  expect(files.map((f) => f.path)).toEqual(["A.kt", "B.kt", "C.kt"]);
});

test("parseApplyPatch: garbage text with no headers yields no files", () => {
  expect(parseApplyPatch("just some\nrandom text\n")).toEqual([]);
});

// --- hunk application ---

test("applyHunks: single hunk replaces its anchor", () => {
  const result = applyHunks("line one\nold line\nline three\n", [{ oldLines: ["old line"], newLines: ["new line"] }]);
  expect(result).toBe("line one\nnew line\nline three\n");
});

test("applyHunks: multiple hunks apply in sequence", () => {
  const result = applyHunks("a\nb\nc\n", [
    { oldLines: ["a"], newLines: ["A"] },
    { oldLines: ["c"], newLines: ["C"] },
  ]);
  expect(result).toBe("A\nb\nC\n");
});

test("applyHunks: missing anchor is undecidable", () => {
  expect(applyHunks("a\nb\n", [{ oldLines: ["does not exist"], newLines: ["x"] }])).toBeNull();
});

test("applyHunks: a pure-insertion hunk (no old lines) is undecidable, not a no-op", () => {
  // Finding #8: a zero-context insertion has no anchor to position it against.
  // Silently dropping it would make the projected content identical to what's
  // already on disk, hiding the insertion from the engine entirely.
  expect(applyHunks("unchanged\n", [{ oldLines: [], newLines: ["inserted"] }])).toBeNull();
});

test("applyHunks: a non-unique anchor is undecidable, not first-match", () => {
  // Finding #9: replacing the first occurrence of a non-unique anchor could
  // patch the wrong site, so the judged bytes could diverge from what Codex
  // actually lands.
  const content = "block\nblock\n";
  expect(applyHunks(content, [{ oldLines: ["block"], newLines: ["patched"] }])).toBeNull();
});

test("applyHunks: a unique anchor still replaces correctly", () => {
  const content = "block\nother\n";
  expect(applyHunks(content, [{ oldLines: ["block"], newLines: ["patched"] }])).toBe("patched\nother\n");
});

// --- verdict merging ---

test("merge: all allow merges to allow", () => {
  expect(
    merge([
      ["A.kt", "allow", null],
      ["B.kt", "allow", null],
    ]),
  ).toBeNull();
});

test("merge: one deny wins and is path-prefixed", () => {
  const result = merge([
    ["Clean.kt", "allow", null],
    ["Bad.kt", "deny", "[no-force-unwrap] line 3: banned"],
  ]);
  expect(reasonOf(result)).toBe("Bad.kt: [no-force-unwrap] line 3: banned");
  expect((result as Verdict).hookSpecificOutput.permissionDecision).toBe("deny");
});

test("merge: multi-line deny reason prefixes every line", () => {
  const result = merge([["Bad.kt", "deny", "[rule-a] line 1: one\n[rule-b] line 2: two"]]);
  expect(reasonOf(result)).toBe("Bad.kt: [rule-a] line 1: one\nBad.kt: [rule-b] line 2: two");
});

test("merge: autofix degrades to deny with the roadmap reason", () => {
  const result = merge([["Fixable.kt", "autofix", { content: "fixed" }]]);
  expect((result as Verdict).hookSpecificOutput.permissionDecision).toBe("deny");
  const reason = reasonOf(result) ?? "";
  expect(reason.startsWith("Fixable.kt: ")).toBeTruthy();
  expect(reason).toContain("Codex v1");
});

test("merge: deny wins over autofix across different files", () => {
  const result = merge([
    ["Fixable.kt", "autofix", { content: "fixed" }],
    ["Bad.kt", "deny", "no good"],
  ]);
  const reason = reasonOf(result) ?? "";
  expect(reason).toContain("Bad.kt: no good");
  expect(reason).toContain("Fixable.kt:");
});

// --- evaluate() with an injected core invocation ---

test("evaluate: three-file batch with mixed verdicts merges to one deny", async () => {
  const workspace = await freshWorkspace();
  const updated = path.join(workspace, "B.kt");
  await Bun.write(updated, "val b = 1\nold line\n");

  const text =
    "*** Begin Patch\n" +
    `*** Add File: ${workspace}/A.kt\n` +
    "+val a = 1\n" +
    `*** Update File: ${updated}\n` +
    "@@\n val b = 1\n-old line\n+new line\n" +
    `*** Delete File: ${workspace}/C.kt\n` +
    "*** End Patch\n";
  const payload = { tool_name: "apply_patch", tool_input: { command: text } };

  const result = await evaluate(payload, {
    invokeCore: async (writeInput): Promise<[string, unknown]> =>
      writeInput.file_path === updated ? ["deny", "[no-force-unwrap] line 2: banned"] : ["allow", null],
  });

  expect(result).not.toBeNull();
  expect(reasonOf(result)).toBe(`${updated}: [no-force-unwrap] line 2: banned`);
});

test("evaluate: three-file batch all clean allows", async () => {
  const workspace = await freshWorkspace();
  const updated = path.join(workspace, "B.kt");
  await Bun.write(updated, "val b = 1\nold line\n");

  const text =
    "*** Begin Patch\n" +
    `*** Add File: ${workspace}/A.kt\n` +
    "+val a = 1\n" +
    `*** Update File: ${updated}\n` +
    "@@\n val b = 1\n-old line\n+new line\n" +
    `*** Delete File: ${workspace}/C.kt\n` +
    "*** End Patch\n";
  const payload = { tool_name: "apply_patch", tool_input: { command: text } };

  const result = await evaluate(payload, {
    invokeCore: async (): Promise<[string, unknown]> => ["allow", null],
  });
  expect(result).toBeNull();
});

test("evaluate: malformed envelopes are silent allow", async () => {
  expect(await evaluate({ tool_name: "Bash", tool_input: { command: "ls" } })).toBeNull();
  expect(await evaluate({ tool_name: "apply_patch", tool_input: { command: "not a patch at all" } })).toBeNull();
  expect(
    await evaluate({ tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** End Patch\n" } }),
  ).toBeNull();
});

// --- evaluate(): undecidable projections fail closed (deny), not silent skip ---

test("evaluate: a pure-insertion Update hunk denies rather than silently allowing", async () => {
  const workspace = await freshWorkspace();
  const target = path.join(workspace, "Insert.kt");
  await Bun.write(target, "package com.example\n\nval a = 1\n");

  // No context/removed lines at all: an all-`+` hunk.
  const text = `*** Begin Patch\n*** Update File: ${target}\n@@\n+val inserted = 1\n*** End Patch\n`;
  const payload = { tool_name: "apply_patch", tool_input: { command: text } };

  const result = await evaluate(payload, {
    invokeCore: async (): Promise<[string, unknown]> => {
      throw new Error("invokeCore must not be called for an undecidable projection");
    },
  });

  expect(result).not.toBeNull();
  const reason = reasonOf(result) ?? "";
  expect(reason).toContain(target);
  expect(reason).toContain("could not confidently determine");
});

test("evaluate: a non-unique anchor denies rather than guessing the first match", async () => {
  const workspace = await freshWorkspace();
  const target = path.join(workspace, "Dup.kt");
  await Bun.write(target, "val x = 1\nval x = 1\n");

  const text = `*** Begin Patch\n*** Update File: ${target}\n@@\n-val x = 1\n+val x = 2\n*** End Patch\n`;
  const payload = { tool_name: "apply_patch", tool_input: { command: text } };

  const result = await evaluate(payload, {
    invokeCore: async (): Promise<[string, unknown]> => {
      throw new Error("invokeCore must not be called for an undecidable projection");
    },
  });

  expect(result).not.toBeNull();
  const reason = reasonOf(result) ?? "";
  expect(reason).toContain(target);
  expect(reason).toContain("could not confidently determine");
});

// --- evaluate() against the real core + real ast-grep ---

test("evaluate: an Update introducing a force-unwrap denies for real", async () => {
  const workspace = await freshWorkspace();
  await writeTenets(workspace);
  const target = path.join(workspace, "Real.kt");
  await Bun.write(target, "package com.example\n\nval safe = 1\n");

  const text =
    "*** Begin Patch\n" +
    `*** Update File: ${target}\n` +
    "@@\n-val safe = 1\n+val unsafe = maybeNull!!\n" +
    "*** End Patch\n";
  const payload = { tool_name: "apply_patch", tool_input: { command: text } };

  const result = await evaluate(payload);

  expect(result).not.toBeNull();
  const reason = reasonOf(result) ?? "";
  expect(reason).toContain(target);
  expect(reason).toContain("no-force-unwrap");
});

test("evaluate: a clean Update allows for real", async () => {
  const workspace = await freshWorkspace();
  await writeTenets(workspace);
  const target = path.join(workspace, "RealClean.kt");
  await Bun.write(target, "package com.example\n\nval a = 1\n");

  const text = `*** Begin Patch\n*** Update File: ${target}\n@@\n-val a = 1\n+val a = 2\n*** End Patch\n`;
  const payload = { tool_name: "apply_patch", tool_input: { command: text } };

  expect(await evaluate(payload)).toBeNull();
});

// --- empty context lines (fail-open regression) ---

test("a bare empty line inside a hunk is an empty context line", () => {
  const text =
    "*** Begin Patch\n*** Update File: A.kt\n@@\n fun a() {}\n\n fun b() {}\n-val ok = 1\n+val ok = 2\n*** End Patch\n";
  const files = parseApplyPatch(text);
  expect(files.length).toBe(1);
  expect(files[0].hunks.length).toBe(1);
  expect(files[0].hunks[0].oldLines).toContain("");
  const projected = applyHunks("fun a() {}\n\nfun b() {}\nval ok = 1\n", files[0].hunks);
  expect(projected).toBe("fun a() {}\n\nfun b() {}\nval ok = 2\n");
});

test("a blank line between file headers stays ignored", () => {
  const text = "*** Begin Patch\n*** Update File: A.kt\n\n@@\n-val a = 1\n+val a = 2\n*** End Patch\n";
  const files = parseApplyPatch(text);
  expect(files.length).toBe(1);
  expect(files[0].hunks.length).toBe(1);
  expect(files[0].hunks[0].oldLines).not.toContain("");
});
