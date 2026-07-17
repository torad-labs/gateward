#!/usr/bin/env python3
"""Pull the gate's block messages out of a captured Claude Code session.

A PreToolUse deny surfaces in the transcript as a tool result whose text starts
with ``Error:`` and carries one or more ``[rule-id] line N: ...`` messages. We
collect those, in order, de-duplicated, so each harvested scenario gets a clean
``<name>.blocks.txt`` alongside the full pane capture.

Usage: extract_blocks.py <session.jsonl> <out.txt>
"""
import json
import re
import sys

RULE_LINE = re.compile(r"\[[a-z0-9-]+\]\s+line\s+\d+:")


def iter_result_texts(path):
    """Yield every tool-result text blob in the transcript."""
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if "line " not in line or "[" not in line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                continue
            result = record.get("toolUseResult")
            if isinstance(result, str):
                yield result
            message = record.get("message", {})
            for part in message.get("content", []) if isinstance(message, dict) else []:
                if isinstance(part, dict) and isinstance(part.get("content"), str):
                    yield part["content"]


def main():
    src, dst = sys.argv[1], sys.argv[2]
    blocks = []
    for text in iter_result_texts(src):
        stripped = text.removeprefix("Error:").strip()
        if RULE_LINE.search(stripped) and stripped not in blocks:
            blocks.append(stripped)
    body = "\n\n".join(blocks) if blocks else "no gate denials found in transcript\n"
    with open(dst, "w", encoding="utf-8") as handle:
        handle.write("── GATE BLOCK MESSAGES ──\n\n" + body + "\n")
    print(f"  {len(blocks)} block message(s) -> {dst}")


if __name__ == "__main__":
    main()
