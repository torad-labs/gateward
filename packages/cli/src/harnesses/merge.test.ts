import { expect, test } from "bun:test";
import { CLAUDE_HOOK_MARKER, mergeClaudeSettings } from "./claude";
import { mergeCodexHooks } from "./codex";
import { COPILOT_HOOK_MARKER, copilotHooksFileText } from "./copilot";

test("mergeClaudeSettings: no existing file creates settings.json with just our hook", () => {
  const { text, changed } = mergeClaudeSettings(null);
  expect(changed).toBe(true);
  const parsed = JSON.parse(text);
  expect(parsed.hooks.PreToolUse.length).toBe(1);
  expect(parsed.hooks.PreToolUse[0].matcher).toBe("Write|Edit");
  expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe(`bun "$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_MARKER}`);
  expect(parsed.hooks.PreToolUse[0].hooks[0].timeout).toBe(30);
});

test("mergeClaudeSettings: an existing user hook survives byte-for-byte except our addition", () => {
  const existingObj = {
    someOtherTopLevelSetting: true,
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/my-user-hook.sh" }] }],
    },
  };
  const existingText = `${JSON.stringify(existingObj, null, 2)}\n`;

  const { text, changed } = mergeClaudeSettings(existingText);
  expect(changed).toBe(true);

  // Hand-build "existing + exactly our one addition" and compare full text,
  // not just parsed structure: this is the byte-for-byte guarantee.
  const expectedObj = JSON.parse(JSON.stringify(existingObj)) as {
    hooks: { PreToolUse: unknown[] };
  };
  expectedObj.hooks.PreToolUse.push({
    matcher: "Write|Edit",
    hooks: [{ type: "command", command: `bun "$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_MARKER}`, timeout: 30 }],
  });
  const expectedText = `${JSON.stringify(expectedObj, null, 2)}\n`;

  expect(text).toBe(expectedText);
});

test("mergeClaudeSettings: preserves unrelated hook event types (e.g. PostToolUse) untouched", () => {
  const existingObj = {
    hooks: {
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "/usr/local/bin/post.sh" }] }],
    },
  };
  const { text } = mergeClaudeSettings(`${JSON.stringify(existingObj, null, 2)}\n`);
  const parsed = JSON.parse(text);
  expect(parsed.hooks.PostToolUse).toEqual(existingObj.hooks.PostToolUse);
  expect(parsed.hooks.PreToolUse.length).toBe(1);
});

test("mergeClaudeSettings: a differently-matched PreToolUse entry does not count as already-wired", () => {
  const existingObj = {
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./scripts/lint.sh" }] }] },
  };
  const { changed } = mergeClaudeSettings(JSON.stringify(existingObj));
  expect(changed).toBe(true);
});

test("mergeClaudeSettings: idempotent — re-merging the already-wired output changes nothing, byte-for-byte", () => {
  const first = mergeClaudeSettings(null);
  expect(first.changed).toBe(true);
  const second = mergeClaudeSettings(first.text);
  expect(second.changed).toBe(false);
  expect(second.text).toBe(first.text);
});

test("mergeClaudeSettings: detects our marker regardless of which other keys sit alongside it", () => {
  const alreadyWired = {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "./scripts/lint.sh" }] },
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: `"$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_MARKER}`, timeout: 30 }],
        },
      ],
    },
  };
  const { changed, text } = mergeClaudeSettings(`${JSON.stringify(alreadyWired, null, 2)}\n`);
  expect(changed).toBe(false);
  expect(text).toBe(`${JSON.stringify(alreadyWired, null, 2)}\n`);
});

test("mergeCodexHooks: creates from scratch and is idempotent on a second merge (provisional schema)", () => {
  const marker = ".tenets/engine/shims/codex/entry.ts";
  const first = mergeCodexHooks(null, marker);
  expect(first.changed).toBe(true);
  const second = mergeCodexHooks(first.text, marker);
  expect(second.changed).toBe(false);
  expect(second.text).toBe(first.text);
});

test("mergeCodexHooks: matches Codex's apply_patch tool, not Claude's Write|Edit", () => {
  // Codex edits files through its single `apply_patch` tool; a Write|Edit
  // matcher would never fire on the real tool call, leaving Codex ungated.
  const parsed = JSON.parse(mergeCodexHooks(null, ".tenets/engine/shims/codex/claude_compat.ts").text);
  expect(parsed.hooks.PreToolUse[0].matcher).toBe("apply_patch");
  // Timeout must exceed the engine's internal scan budget so the engine's own
  // fail-closed deny fires before the harness would kill the hook (fail open).
  expect(parsed.hooks.PreToolUse[0].hooks[0].timeout).toBe(30);
});

test("copilotHooksFileText: Copilot's hooks-file schema, matching its file tools on every surface", () => {
  const parsed = JSON.parse(copilotHooksFileText());
  expect(parsed.version).toBe(1);
  const [entry] = parsed.hooks.preToolUse;
  expect(entry.type).toBe("command");
  // Native Copilot CLI tool names AND the Claude-compat names VS Code's hook
  // bridge may emit; a matcher missing the real tool name leaves that surface
  // ungated (the Codex apply_patch lesson).
  expect(entry.matcher).toBe("create|edit|Write|Edit");
  // Both interpreters carry the same bun command, per Copilot's cross-OS hook
  // guidance.
  expect(entry.bash).toBe(`bun ${COPILOT_HOOK_MARKER}`);
  expect(entry.powershell).toBe(`bun ${COPILOT_HOOK_MARKER}`);
  // Copilot preToolUse TIMEOUTS fail open (crashes fail closed): timeoutSec
  // must exceed the shim's internal 30s engine budget so a hung engine
  // surfaces as the shim's explicit deny, never as a fail-open timeout.
  expect(entry.timeoutSec).toBe(60);
  expect(entry.cwd).toBe(".");
});
