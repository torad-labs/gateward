import * as assert from "node:assert/strict";
import { test } from "node:test";
import { CLAUDE_HOOK_MARKER, mergeClaudeSettings, mergeCodexHooks } from "./merge";

test("mergeClaudeSettings: no existing file creates settings.json with just our hook", () => {
  const { text, changed } = mergeClaudeSettings(null);
  assert.equal(changed, true);
  const parsed = JSON.parse(text);
  assert.equal(parsed.hooks.PreToolUse.length, 1);
  assert.equal(parsed.hooks.PreToolUse[0].matcher, "Write|Edit");
  assert.equal(parsed.hooks.PreToolUse[0].hooks[0].command, `python3 "$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_MARKER}`);
  assert.equal(parsed.hooks.PreToolUse[0].hooks[0].timeout, 10);
});

test("mergeClaudeSettings: an existing user hook survives byte-for-byte except our addition", () => {
  const existingObj = {
    someOtherTopLevelSetting: true,
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/my-user-hook.sh" }] }],
    },
  };
  const existingText = JSON.stringify(existingObj, null, 2) + "\n";

  const { text, changed } = mergeClaudeSettings(existingText);
  assert.equal(changed, true);

  // Hand-build "existing + exactly our one addition" and compare full text,
  // not just parsed structure: this is the byte-for-byte guarantee.
  const expectedObj: any = JSON.parse(JSON.stringify(existingObj));
  expectedObj.hooks.PreToolUse.push({
    matcher: "Write|Edit",
    hooks: [{ type: "command", command: `python3 "$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_MARKER}`, timeout: 10 }],
  });
  const expectedText = JSON.stringify(expectedObj, null, 2) + "\n";

  assert.equal(text, expectedText);
});

test("mergeClaudeSettings: preserves unrelated hook event types (e.g. PostToolUse) untouched", () => {
  const existingObj = {
    hooks: {
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "/usr/local/bin/post.sh" }] }],
    },
  };
  const { text } = mergeClaudeSettings(JSON.stringify(existingObj, null, 2) + "\n");
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.hooks.PostToolUse, existingObj.hooks.PostToolUse);
  assert.equal(parsed.hooks.PreToolUse.length, 1);
});

test("mergeClaudeSettings: a differently-matched PreToolUse entry does not count as already-wired", () => {
  const existingObj = {
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./scripts/lint.sh" }] }] },
  };
  const { changed } = mergeClaudeSettings(JSON.stringify(existingObj));
  assert.equal(changed, true);
});

test("mergeClaudeSettings: idempotent — re-merging the already-wired output changes nothing, byte-for-byte", () => {
  const first = mergeClaudeSettings(null);
  assert.equal(first.changed, true);
  const second = mergeClaudeSettings(first.text);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

test("mergeClaudeSettings: detects our marker regardless of which other keys sit alongside it", () => {
  const alreadyWired = {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "./scripts/lint.sh" }] },
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: `"$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_MARKER}`, timeout: 10 }],
        },
      ],
    },
  };
  const { changed, text } = mergeClaudeSettings(JSON.stringify(alreadyWired, null, 2) + "\n");
  assert.equal(changed, false);
  assert.equal(text, JSON.stringify(alreadyWired, null, 2) + "\n");
});

test("mergeCodexHooks: creates from scratch and is idempotent on a second merge (provisional schema)", () => {
  const marker = ".tenets/engine/shims/codex/entry.py";
  const first = mergeCodexHooks(null, marker);
  assert.equal(first.changed, true);
  const second = mergeCodexHooks(first.text, marker);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});
