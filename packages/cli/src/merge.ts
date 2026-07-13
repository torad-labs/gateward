/**
 * Merge-not-clobber for harness hook config: parse the existing JSON (or
 * start from `{}` if absent), append our PreToolUse entry only when no
 * existing entry already references our marker path, and never otherwise
 * touch the parsed structure — every unrelated key/entry round-trips through
 * JSON.parse/stringify untouched.
 */

interface JsonObject {
  [key: string]: unknown;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface MergeResult {
  text: string;
  changed: boolean;
}

function mergePreToolUseHook(existingText: string | null, marker: string, hookEntry: JsonObject): MergeResult {
  const settings: JsonObject = existingText ? (JSON.parse(existingText) as JsonObject) : {};
  const hooks: JsonObject = isJsonObject(settings.hooks) ? settings.hooks : {};
  const preToolUse: unknown[] = Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as unknown[]) : [];
  settings.hooks = hooks;
  hooks.PreToolUse = preToolUse;

  const alreadyWired = preToolUse.some((entry) => {
    if (!isJsonObject(entry)) return false;
    const entryHooks = Array.isArray(entry.hooks) ? (entry.hooks as unknown[]) : [];
    return entryHooks.some((h) => isJsonObject(h) && typeof h.command === "string" && h.command.includes(marker));
  });

  if (!alreadyWired) preToolUse.push(hookEntry);
  return { text: JSON.stringify(settings, null, 2) + "\n", changed: !alreadyWired };
}

export const CLAUDE_HOOK_MARKER = ".tenets/engine/events/pretooluse.py";

/** Merges the PreToolUse -> pretooluse.py entry into a Claude Code settings.json.
 * The command runs the vendored entrypoint through python3 explicitly: exec
 * bits do not survive every transport (zip downloads, some git configs), and
 * a hook that fails with exit 126 is a silently dead gate. */
export function mergeClaudeSettings(existingText: string | null): MergeResult {
  return mergePreToolUseHook(existingText, CLAUDE_HOOK_MARKER, {
    matcher: "Write|Edit",
    hooks: [{ type: "command", command: `python3 "$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_MARKER}`, timeout: 10 }],
  });
}

/**
 * Wires the vendored Codex shim into .codex/hooks.json. Codex adopted Claude
 * Code's hook JSON (research/harness-hooks-matrix.md), so the entry mirrors
 * mergeClaudeSettings. The command is python3 plus a project-relative path —
 * Codex documents no project-dir env var, so we rely on project hooks running
 * from the project root. Unconfirmed against a real Codex install; the shim's
 * own docstring carries the same flag.
 */
export function mergeCodexHooks(existingText: string | null, relEntrypoint: string): MergeResult {
  return mergePreToolUseHook(existingText, relEntrypoint, {
    matcher: "Write|Edit",
    hooks: [{ type: "command", command: `python3 ${JSON.stringify(relEntrypoint)}`, timeout: 10 }],
  });
}
