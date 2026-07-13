"""PreToolUse verdicts in the Claude Code hook JSON shape.

* allow   -> ``None``; the hook prints nothing and exits 0.
* deny    -> ``permissionDecision: "deny"`` plus a reason the model reads.
* autofix -> ``permissionDecision: "allow"`` plus ``updatedInput`` carrying the
  rewritten content (Write) or new_string (Edit).
"""
EVENT = "PreToolUse"


def allow():
    """No output: the tool call proceeds unchanged."""
    return None


def deny(reason):
    """Block the tool call; ``reason`` is surfaced to the model."""
    return {
        "hookSpecificOutput": {
            "hookEventName": EVENT,
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def autofix(updated_input):
    """Allow the tool call but rewrite its input in flight.

    The allow + ``updatedInput`` shape is documented for Codex, which adopted
    Claude Code's hook JSON. Whether Claude Code requires the companion
    ``permissionDecision: "allow"`` and this exact nesting of ``updatedInput``
    is to be confirmed empirically against a live install.
    """
    return {
        "hookSpecificOutput": {
            "hookEventName": EVENT,
            "permissionDecision": "allow",
            "updatedInput": updated_input,
        }
    }
