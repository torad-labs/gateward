#!/usr/bin/env python3
"""End-to-end replay harness — the spike, institutionalized.

Each case in ``payloads/`` is a Claude Code PreToolUse payload (``*.payload.json``)
paired with an expected verdict (``*.expected.json``) and, for Edit cases, a
starting file (``*.fixture.kt``). The runner builds a throwaway workspace with a
real ``.tenets/config.toml`` pointing at this repo's packs, substitutes the
``{{WORKSPACE}}`` placeholder in each payload, pipes it through the core
PreToolUse entrypoint as a subprocess, and asserts the verdict class (allow /
deny / autofix). For deny it checks the reason names the expected rule; for
autofix it checks the rewritten input. Exits non-zero on any mismatch.

A payload whose ``tool_name`` is ``apply_patch`` is a Codex-shaped case: it is
piped through ``packages/shims/codex/claude_compat.py`` instead of the core
entrypoint directly. That shim emits the same verdict JSON shape core does,
so classification below is unchanged either way.

Standard library only; no network. Run: ``python3 e2e/run.py``.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CORE = REPO / "packages" / "core" / "src" / "events" / "pretooluse.py"
CODEX_SHIM = REPO / "packages" / "shims" / "codex" / "claude_compat.py"
PACKS = REPO / "packs"
PAYLOADS = HERE / "payloads"
PLACEHOLDER = "{{WORKSPACE}}"

CONFIG_TOML = """[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "{packs}"
enabled = ["kotlin-best-practices", "android-architecture", "android-best-practices", "android-opinionated"]

[rules.no-assert-equals-boolean]
tier = "autofix"
"""


def build_workspace():
    workspace = Path(tempfile.mkdtemp(prefix="portable-hooks-e2e-"))
    tenets = workspace / ".tenets"
    tenets.mkdir()
    (tenets / "config.toml").write_text(CONFIG_TOML.format(packs=PACKS), encoding="utf-8")
    return workspace


def run_case(case, workspace):
    payload_text = (PAYLOADS / f"{case}.payload.json").read_text(encoding="utf-8")
    payload = json.loads(payload_text.replace(PLACEHOLDER, str(workspace)))
    expected = json.loads((PAYLOADS / f"{case}.expected.json").read_text(encoding="utf-8"))

    fixture = PAYLOADS / f"{case}.fixture.kt"
    if fixture.is_file():
        target = Path(payload["tool_input"]["file_path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(fixture.read_text(encoding="utf-8"), encoding="utf-8")

    env = dict(os.environ)
    if expected.get("scanner") == "absent":
        env["PATH"] = "/nonexistent"  # make the ast-grep binary unfindable

    entrypoint = CODEX_SHIM if payload.get("tool_name") == "apply_patch" else CORE
    result = subprocess.run(
        [sys.executable, str(entrypoint)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )
    kind, detail = _classify(result.stdout)
    return _judge(expected, kind, detail, result.stderr)


def _classify(stdout):
    text = stdout.strip()
    if not text:
        return "allow", None
    data = json.loads(text)
    hook_output = data.get("hookSpecificOutput", {})
    decision = hook_output.get("permissionDecision")
    if decision == "deny":
        return "deny", hook_output.get("permissionDecisionReason", "")
    if decision == "allow":
        updated = hook_output.get("updatedInput", data.get("updatedInput"))
        if updated is not None:
            return "autofix", updated
        return "allow", None
    return "unknown", text


def _judge(expected, kind, detail, stderr):
    want = expected["verdict"]
    if kind != want:
        note = f" (stderr: {stderr.strip()})" if stderr.strip() else ""
        return False, f"expected {want}, got {kind}{note}"

    if want == "deny":
        reason = detail or ""
        needle = expected.get("contains", "")
        if needle not in reason:
            return False, f"deny reason missing {needle!r}: {reason!r}"
        if "lines" in expected:
            count = len([line for line in reason.splitlines() if line.strip()])
            if count != expected["lines"]:
                return False, f"expected {expected['lines']} violation line(s), got {count}"

    if want == "autofix":
        target = expected["target"]
        if not isinstance(detail, dict) or target not in detail:
            return False, f"updatedInput missing {target!r}: {detail!r}"
        needle = expected.get("contains", "")
        if needle not in detail[target]:
            return False, f"updatedInput.{target} missing {needle!r}: {detail[target]!r}"

    return True, ""


def main():
    cases = sorted(path.name[: -len(".payload.json")] for path in PAYLOADS.glob("*.payload.json"))
    workspace = build_workspace()
    failures = 0
    try:
        for case in cases:
            passed, message = run_case(case, workspace)
            print(f"{'PASS' if passed else 'FAIL'}  {case}  {message}".rstrip())
            failures += 0 if passed else 1
    finally:
        shutil.rmtree(workspace, ignore_errors=True)

    total = len(cases)
    print(f"\n{total - failures}/{total} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
