#!/usr/bin/env python3
"""PreToolUse entrypoint.

Reads a Claude Code PreToolUse payload on stdin and writes a verdict to stdout
(nothing = allow). The gate runs in stages: config -> projection -> scan -> diff
-> verdict. Each early return is a deliberate "not ours / not enforcing / can't
decide" allow.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config as config_mod
import diff as diff_mod
import projection as projection_mod
import scan as scan_mod
import verdict as verdict_mod


def evaluate(payload):
    """Return a verdict dict, or ``None`` to allow the tool call."""
    tool_name = payload.get("tool_name", "")
    if tool_name not in (projection_mod.WRITE, projection_mod.EDIT):
        return verdict_mod.allow()  # unknown tool

    tool_input = payload.get("tool_input", {})
    path = tool_input.get("file_path")
    if not path:
        return verdict_mod.allow()

    config = config_mod.find(path)
    if config is None:
        return verdict_mod.allow()  # no .tenets/: not installed here

    if not config.gates(path):
        return verdict_mod.allow()  # a file type this project does not gate

    proj = projection_mod.project(tool_name, tool_input)
    if proj is None:
        return verdict_mod.allow()  # undecidable edit: let the harness decide

    try:
        current = scan_mod.scan(proj.current, proj.path, config)
        projected = scan_mod.scan(proj.projected, proj.path, config)
    except scan_mod.AstGrepMissing:
        # Config is present and gates this file, but the scanner is gone:
        # fail closed rather than wave the edit through unchecked.
        return verdict_mod.deny(_missing_binary_reason())

    fresh = diff_mod.new_violations(current, projected)
    if not fresh:
        return verdict_mod.allow()

    # Anything not explicitly autofix-tier blocks (fail closed). If any blocking
    # violation is new, deny wins: we never autofix alongside a block.
    blocking = [match for match in fresh if match.tier != config_mod.TIER_AUTOFIX]
    if blocking:
        return verdict_mod.deny(_deny_reason(blocking))

    return _autofix(proj, tool_input, config)


def _autofix(proj, tool_input, config):
    if proj.tool_name == projection_mod.WRITE:
        fixed = scan_mod.apply_fix(proj.projected, proj.path, config)
        return verdict_mod.autofix({"content": fixed})
    # Edit: fix only the newly written text. The new finding lives in
    # new_string, so fixing it in isolation leaves surrounding legacy code
    # untouched.
    new_string = tool_input.get("new_string", "")
    fixed = scan_mod.apply_fix(new_string, proj.path, config)
    return verdict_mod.autofix({"new_string": fixed})


def _deny_reason(matches):
    return "\n".join(
        f"[{match.rule_id}] line {match.line}: {match.message}"
        for match in matches
    )


def _missing_binary_reason():
    return (
        "[portable-hooks] ast-grep is not installed, but this project's "
        ".tenets/ enables Kotlin rules. Install it (npm i -g @ast-grep/cli, or "
        "brew install ast-grep), then retry. Refusing to allow unchecked "
        "Kotlin edits."
    )


def main():
    payload = json.load(sys.stdin)
    result = evaluate(payload)
    if result is not None:
        print(json.dumps(result))


if __name__ == "__main__":
    main()
