#!/usr/bin/env python3
"""Run the portable-hooks PreToolUse gate against Codex's ``apply_patch`` tool.

Ported from the author's personal Codex translator
(``~/.codex/hooks/claude_compat.py``), simplified to this product's scope: we
only need to gate file edits, not every Claude lifecycle event, so this file
covers exactly one direction — Codex's ``apply_patch`` PreToolUse call — and
does not carry that reference's Stop/UserPromptSubmit/in-process-runner
machinery.

Envelope shapes handled
------------------------
Codex's PreToolUse payload names the tool ``apply_patch`` and carries the
patch as a ``*** Begin Patch`` ... ``*** End Patch`` text envelope in
``tool_input.command``. Two shapes of that field are handled: a plain string,
and the shell-array invocation form ``["apply_patch", "<patch text>"]`` (the
array element containing the ``*** Begin Patch`` marker is used regardless of
position). Anything else — no ``tool_input.command``, a command that is not
patch-shaped, an envelope with no recognizable ``Add File``/``Update
File``/``Delete File`` header — is treated as not ours: silent allow. Codex's
own harness validates the envelope independently; this shim does not need to
duplicate that.

Per-file projection
--------------------
Each touched file becomes one Claude-shaped ``Write`` call so core's
projection module can do its normal on-disk-vs-projected diff:

* ``Add File`` — the full new content, verbatim.
* ``Delete File`` — empty content (core then judges "does emptying this file
  introduce a new violation", which in practice it never does).
* ``Update File`` — core needs the file's *projected* full content, not a
  patch. Each hunk's context+removed lines are located as a contiguous block
  in the real on-disk file and replaced with that hunk's context+added
  lines, hunks applied in order. A hunk whose anchor cannot be found (a stale
  patch against content that has since changed) makes the whole file
  undecidable and it is skipped — the same "can't decide, let the harness
  reject it" stance :mod:`projection` takes for a bad ``old_string``.

``*** Move to:`` (rename-with-content-change) is not handled: out of this
product's scope, not one of the three hunk kinds this command was asked to
support.

Per-file judging and merge
----------------------------
Each projected file is handed to core's real PreToolUse entrypoint
(``packages/core/src/events/pretooluse.py``) as its own subprocess, same
Python interpreter — one on-disk-vs-projected judgment per file, exactly what
the hook already knows how to do. Verdicts are then merged:

* Any file denies -> the whole patch denies. The merged reason is every
  denied file's reason, one violation per line, each line prefixed with that
  file's path (so a multi-file patch's deny reason still says which file each
  violation belongs to).
* No deny, but a file's verdict is autofix-tier -> the whole patch denies too.
  **Roadmap note (not a TODO, a documented product limitation):** core's
  autofix verdict means "here is the rewritten content the hook would have
  applied for you", but Codex v1's ``apply_patch`` protocol has no channel for
  this shim to hand back a revised patch envelope for Codex to apply instead —
  regenerating and re-offering a patch envelope is future work. Until that
  exists, an autofix-tier finding degrades to a deny that names the violation
  and says so, rather than silently allowing a fixable violation through.
* Every file allows -> silent allow, matching a clean Claude Code edit.

Codex adopted Claude Code's PreToolUse hook JSON verbatim (confirmed against
the harness-hooks-matrix research: identical ``hookSpecificOutput`` deny
shape), so the merged verdict is emitted using core's own :mod:`verdict`
module — no translation layer needed for the output side.
"""
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve()
PACKAGES_DIR = HERE.parents[2]
CORE_SRC = PACKAGES_DIR / "core" / "src"
CORE_PRETOOLUSE = CORE_SRC / "events" / "pretooluse.py"

sys.path.insert(0, str(CORE_SRC))
import verdict as verdict_mod  # noqa: E402

ADD = "Add"
UPDATE = "Update"
DELETE = "Delete"

_SUBPROCESS_TIMEOUT_SECONDS = 60

AUTOFIX_ROADMAP_REASON = (
    "autofix-tier violation found, but Codex v1's apply_patch protocol has no "
    "channel to hand back an updated patch envelope — fix this manually, or "
    "make the edit through Claude Code where autofix can rewrite it in place."
)


@dataclass
class PatchHunk:
    old_lines: list = field(default_factory=list)  # context + removed, pre-patch order
    new_lines: list = field(default_factory=list)   # context + added, post-patch order


@dataclass
class PatchFile:
    path: str
    kind: str
    new_lines: list = field(default_factory=list)   # Add: full new content
    hunks: list = field(default_factory=list)        # Update: ordered hunks


def evaluate(payload):
    """Return a verdict dict, or ``None`` to allow. Kept separate from
    ``main`` so tests can drive it without touching stdin/stdout, mirroring
    core's own ``events/pretooluse.py`` evaluate/main split."""
    if not isinstance(payload, dict) or payload.get("tool_name") != "apply_patch":
        return None

    patch_text = _patch_text(payload)
    if not patch_text:
        return None

    patch_files = _parse_apply_patch(patch_text)
    if not patch_files:
        return None  # header-less/malformed envelope: silent allow

    cwd = payload.get("cwd") or os.getcwd()
    file_verdicts = []
    for patch_file in patch_files:
        write_input = _project_write_input(patch_file, cwd)
        if write_input is None:
            continue  # undecidable projection: let the harness reject it itself
        kind, detail = _invoke_core(write_input)
        file_verdicts.append((patch_file.path, kind, detail))

    return _merge(file_verdicts)


def _patch_text(payload):
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, str):
        return tool_input if "*** Begin Patch" in tool_input else ""
    if not isinstance(tool_input, dict):
        return ""
    return _command_patch_text(tool_input.get("command"))


def _command_patch_text(command):
    if isinstance(command, str):
        return command if "*** Begin Patch" in command else ""
    if isinstance(command, list):
        for item in command:
            if isinstance(item, str) and "*** Begin Patch" in item:
                return item
    return ""


def _parse_apply_patch(text):
    """Parse Add File / Update File / Delete File hunks. Unrecognized text
    (no header lines at all) yields an empty list."""
    files = []
    current = None
    current_hunk = None

    def hunk():
        nonlocal current_hunk
        if current_hunk is None:
            current_hunk = PatchHunk()
        return current_hunk

    def flush_hunk():
        nonlocal current_hunk
        if current is not None and current_hunk is not None:
            if current_hunk.old_lines or current_hunk.new_lines:
                current.hunks.append(current_hunk)
        current_hunk = None

    def flush_file():
        nonlocal current
        flush_hunk()
        if current is not None:
            files.append(current)
        current = None

    for raw in text.splitlines():
        if raw.startswith("*** Add File: "):
            flush_file()
            current = PatchFile(path=raw[len("*** Add File: "):], kind=ADD)
        elif raw.startswith("*** Update File: "):
            flush_file()
            current = PatchFile(path=raw[len("*** Update File: "):], kind=UPDATE)
        elif raw.startswith("*** Delete File: "):
            flush_file()
            current = PatchFile(path=raw[len("*** Delete File: "):], kind=DELETE)
        elif raw.startswith("*** End Patch"):
            flush_file()
        elif raw.startswith("@@"):
            flush_hunk()
        elif current is None:
            continue
        elif current.kind == ADD:
            if raw.startswith("+"):
                current.new_lines.append(raw[1:])
        elif current.kind == UPDATE:
            if raw.startswith("+"):
                hunk().new_lines.append(raw[1:])
            elif raw.startswith(" "):
                h = hunk()
                h.old_lines.append(raw[1:])
                h.new_lines.append(raw[1:])
            elif raw.startswith("-"):
                hunk().old_lines.append(raw[1:])
            elif raw == "" and current_hunk is not None:
                # A bare empty line inside a hunk is an empty context line —
                # some generators emit "" instead of the space-prefixed form.
                # Dropping it breaks the anchor and silently skips (allows) a
                # patch Codex itself would apply fine: fail-open. Keep it.
                current_hunk.old_lines.append("")
                current_hunk.new_lines.append("")

    flush_file()
    return files


def _apply_hunks(content, hunks):
    """Apply ``hunks`` against on-disk ``content`` in order. Returns the
    resulting text, or ``None`` if a hunk's anchor (its context+removed
    block) cannot be located — a stale patch, left undecidable rather than
    guessed at."""
    result = content
    for h in hunks:
        if not h.old_lines:
            continue
        anchor = "\n".join(h.old_lines)
        replacement = "\n".join(h.new_lines)
        if anchor not in result:
            return None
        result = result.replace(anchor, replacement, 1)
    return result


def _resolve_path(raw_path, cwd):
    path = Path(raw_path)
    return path if path.is_absolute() else Path(cwd) / path


def _project_write_input(patch_file, cwd):
    """A Claude-shaped Write ``tool_input`` for one touched file, or ``None``
    when the change cannot be confidently projected."""
    path = _resolve_path(patch_file.path, cwd)
    if patch_file.kind == ADD:
        return {"file_path": str(path), "content": "\n".join(patch_file.new_lines)}
    if patch_file.kind == DELETE:
        return {"file_path": str(path), "content": ""}

    try:
        current = path.read_text(encoding="utf-8")
    except OSError:
        return None
    projected = _apply_hunks(current, patch_file.hunks)
    if projected is None:
        return None
    return {"file_path": str(path), "content": projected}


def _invoke_core(write_input):
    """Run core's pretooluse.py against one synthetic Write payload and
    classify the result as ("allow"|"deny"|"autofix", detail).

    Fails closed (deny) if the subprocess cannot run, times out, or exits
    nonzero without an explicit verdict — the same fail-closed stance core
    itself takes when it cannot judge (see pretooluse._missing_binary_reason).
    """
    stdin_payload = json.dumps({"tool_name": "Write", "tool_input": write_input})
    try:
        result = subprocess.run(
            [sys.executable, str(CORE_PRETOOLUSE)],
            input=stdin_payload,
            capture_output=True,
            text=True,
            timeout=_SUBPROCESS_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return "deny", f"portable-hooks core could not run: {exc}"

    out = result.stdout.strip()
    if not out:
        if result.returncode != 0:
            return "deny", f"portable-hooks core exited {result.returncode} with no verdict"
        return "allow", None

    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return "deny", f"portable-hooks core printed unparseable output: {out!r}"

    hook_output = data.get("hookSpecificOutput", {}) if isinstance(data, dict) else {}
    decision = hook_output.get("permissionDecision")
    if decision == "deny":
        return "deny", hook_output.get("permissionDecisionReason", "denied")
    if decision == "allow" and "updatedInput" in hook_output:
        return "autofix", hook_output["updatedInput"]
    return "allow", None


def _merge(file_verdicts):
    """Merge per-file (path, kind, detail) verdicts into one Codex-shaped
    verdict: any deny (or autofix, degraded — see module docstring) wins,
    each reason line prefixed with its file's path; otherwise allow."""
    deny_lines = []
    for path, kind, detail in file_verdicts:
        if kind == "deny":
            reason = detail or "denied"
        elif kind == "autofix":
            reason = AUTOFIX_ROADMAP_REASON
        else:
            continue
        for line in reason.splitlines() or [reason]:
            deny_lines.append(f"{path}: {line}")

    if deny_lines:
        return verdict_mod.deny("\n".join(deny_lines))
    return verdict_mod.allow()


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        return 0
    result = evaluate(payload)
    if result is not None:
        print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
