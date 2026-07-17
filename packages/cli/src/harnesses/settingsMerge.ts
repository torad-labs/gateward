/**
 * Merge-not-clobber for harness hook config: parse the existing JSON (or
 * start from `{}` if absent), append our PreToolUse entry only when no
 * existing entry already references our marker path, and never otherwise
 * touch the parsed structure — every unrelated key/entry round-trips through
 * JSON.parse/stringify untouched.
 */

export interface JsonObject {
  [key: string]: unknown;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface MergeResult {
  text: string;
  changed: boolean;
}

export function mergePreToolUseHook(existingText: string | null, marker: string, hookEntry: JsonObject): MergeResult {
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
  return { text: `${JSON.stringify(settings, null, 2)}\n`, changed: !alreadyWired };
}
