/**
 * PreToolUse verdicts in the Claude Code hook JSON shape.
 *
 * - allow   -> null; the hook prints nothing and exits 0.
 * - deny    -> `permissionDecision: "deny"` plus a reason the model reads.
 * - autofix -> `permissionDecision: "allow"` plus `updatedInput` carrying the
 *   rewritten content (Write) or new_string (Edit).
 */
export const EVENT = "PreToolUse";

export interface Verdict {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: "deny" | "allow";
    permissionDecisionReason?: string;
    updatedInput?: Record<string, string>;
  };
}

/** No output: the tool call proceeds unchanged. */
export function allow(): null {
  return null;
}

/** Block the tool call; `reason` is surfaced to the model. */
export function deny(reason: string): Verdict {
  return {
    hookSpecificOutput: {
      hookEventName: EVENT,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Allow the tool call but rewrite its input in flight.
 *
 * The allow + `updatedInput` shape is documented for Codex, which adopted
 * Claude Code's hook JSON. Whether Claude Code requires the companion
 * `permissionDecision: "allow"` and this exact nesting of `updatedInput`
 * is to be confirmed empirically against a live install.
 */
export function autofix(updatedInput: Record<string, string>): Verdict {
  return {
    hookSpecificOutput: {
      hookEventName: EVENT,
      permissionDecision: "allow",
      updatedInput,
    },
  };
}
