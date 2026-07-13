"""Reconstruct the file content a tool call would produce, without writing it.

The gate judges the *projected* content, never the raw edit instruction: Write
supplies the whole file; Edit is replayed against the current on-disk file. When
the outcome is undecidable — an Edit whose ``old_string`` is not in the file, or
a missing file — the gate declines to judge. The harness will reject that edit
on its own, and we never double-judge.
"""
from dataclasses import dataclass
from pathlib import Path

WRITE = "Write"
EDIT = "Edit"


@dataclass(frozen=True)
class Projection:
    """The before/after content of a decidable, gated tool call."""

    path: str
    tool_name: str
    current: str    # on-disk content before the call ("" for a new file)
    projected: str  # content the call would produce


def project(tool_name, tool_input):
    """Return a :class:`Projection`, or ``None`` when the call is not ours or
    is undecidable."""
    path = tool_input.get("file_path")
    if not path:
        return None

    if tool_name == WRITE:
        content = tool_input.get("content")
        if content is None:
            return None
        current = _read(path)
        return Projection(path, WRITE, current or "", content)

    if tool_name == EDIT:
        old_string = tool_input.get("old_string")
        if not old_string:
            return None  # empty/missing anchor -> undecidable
        current = _read(path)
        if current is None or old_string not in current:
            return None  # missing file, or a stale anchor -> undecidable
        new_string = tool_input.get("new_string", "")
        if tool_input.get("replace_all", False):
            projected = current.replace(old_string, new_string)
        else:
            projected = current.replace(old_string, new_string, 1)
        return Projection(path, EDIT, current, projected)

    return None


def _read(path):
    try:
        return Path(path).read_text(encoding="utf-8")
    except (FileNotFoundError, IsADirectoryError):
        return None
