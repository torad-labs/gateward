"""Unit tests for the Codex apply_patch -> Claude Code compat shim.

Envelope parsing, hunk application, and verdict merging are tested as pure
logic (no subprocess). ``evaluate()`` is additionally tested end-to-end twice:
once with ``_invoke_core`` mocked (a 3-file batch, and a malformed envelope —
both cases the task spec calls out explicitly), and once for real against the
actual core entrypoint and a live ast-grep, to prove the whole chain —
envelope parse, hunk projection, per-file subprocess judging, merge — wires
together correctly and not just when stubbed.
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import claude_compat  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
PACKS = REPO / "packs"

CONFIG_TOML = """[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "{packs}"
enabled = ["kotlin-best-practices"]
"""


def _write_tenets(project_root):
    tenets = project_root / ".tenets"
    tenets.mkdir(parents=True)
    (tenets / "config.toml").write_text(CONFIG_TOML.format(packs=PACKS), encoding="utf-8")


class PatchTextExtraction(unittest.TestCase):
    def test_plain_string_command(self):
        payload = {"tool_input": {"command": "*** Begin Patch\n*** End Patch\n"}}
        self.assertEqual(claude_compat._patch_text(payload), "*** Begin Patch\n*** End Patch\n")

    def test_shell_array_invocation_form(self):
        payload = {"tool_input": {"command": ["apply_patch", "*** Begin Patch\n*** End Patch\n"]}}
        self.assertEqual(claude_compat._patch_text(payload), "*** Begin Patch\n*** End Patch\n")

    def test_tool_input_as_raw_string(self):
        payload = {"tool_input": "*** Begin Patch\n*** End Patch\n"}
        self.assertEqual(claude_compat._patch_text(payload), "*** Begin Patch\n*** End Patch\n")

    def test_command_without_patch_marker_is_not_ours(self):
        payload = {"tool_input": {"command": "ls -la"}}
        self.assertEqual(claude_compat._patch_text(payload), "")

    def test_missing_tool_input(self):
        self.assertEqual(claude_compat._patch_text({}), "")

    def test_shell_array_with_no_patch_element(self):
        payload = {"tool_input": {"command": ["ls", "-la"]}}
        self.assertEqual(claude_compat._patch_text(payload), "")


class ParseApplyPatch(unittest.TestCase):
    def test_add_file_collects_full_content(self):
        text = (
            "*** Begin Patch\n"
            "*** Add File: New.kt\n"
            "+package com.example\n"
            "+\n"
            "+val x = 1\n"
            "*** End Patch\n"
        )
        files = claude_compat._parse_apply_patch(text)
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].kind, claude_compat.ADD)
        self.assertEqual(files[0].path, "New.kt")
        self.assertEqual(files[0].new_lines, ["package com.example", "", "val x = 1"])

    def test_update_file_collects_one_hunk(self):
        text = (
            "*** Begin Patch\n"
            "*** Update File: Existing.kt\n"
            "@@\n"
            " package com.example\n"
            "-val old = 1\n"
            "+val new = 2\n"
            "*** End Patch\n"
        )
        files = claude_compat._parse_apply_patch(text)
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].kind, claude_compat.UPDATE)
        self.assertEqual(len(files[0].hunks), 1)
        hunk = files[0].hunks[0]
        self.assertEqual(hunk.old_lines, ["package com.example", "val old = 1"])
        self.assertEqual(hunk.new_lines, ["package com.example", "val new = 2"])

    def test_delete_file(self):
        text = "*** Begin Patch\n*** Delete File: Gone.kt\n*** End Patch\n"
        files = claude_compat._parse_apply_patch(text)
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].kind, claude_compat.DELETE)
        self.assertEqual(files[0].path, "Gone.kt")

    def test_three_file_batch_parses_all_three_in_order(self):
        text = (
            "*** Begin Patch\n"
            "*** Add File: A.kt\n"
            "+val a = 1\n"
            "*** Update File: B.kt\n"
            "@@\n"
            " val b = 1\n"
            "-val old = 1\n"
            "+val new = 2\n"
            "*** Delete File: C.kt\n"
            "*** End Patch\n"
        )
        files = claude_compat._parse_apply_patch(text)
        self.assertEqual([f.kind for f in files], [claude_compat.ADD, claude_compat.UPDATE, claude_compat.DELETE])
        self.assertEqual([f.path for f in files], ["A.kt", "B.kt", "C.kt"])

    def test_garbage_text_with_no_headers_yields_no_files(self):
        self.assertEqual(claude_compat._parse_apply_patch("just some\nrandom text\n"), [])


class ApplyHunksTest(unittest.TestCase):
    def test_single_hunk_replaces_anchor(self):
        content = "line one\nold line\nline three\n"
        hunk = claude_compat.PatchHunk(old_lines=["old line"], new_lines=["new line"])
        result = claude_compat._apply_hunks(content, [hunk])
        self.assertEqual(result, "line one\nnew line\nline three\n")

    def test_multiple_hunks_apply_in_sequence(self):
        content = "a\nb\nc\n"
        hunks = [
            claude_compat.PatchHunk(old_lines=["a"], new_lines=["A"]),
            claude_compat.PatchHunk(old_lines=["c"], new_lines=["C"]),
        ]
        result = claude_compat._apply_hunks(content, hunks)
        self.assertEqual(result, "A\nb\nC\n")

    def test_missing_anchor_is_undecidable(self):
        hunk = claude_compat.PatchHunk(old_lines=["does not exist"], new_lines=["x"])
        self.assertIsNone(claude_compat._apply_hunks("a\nb\n", [hunk]))

    def test_hunk_with_no_old_lines_is_a_no_op(self):
        hunk = claude_compat.PatchHunk(old_lines=[], new_lines=["ignored"])
        self.assertEqual(claude_compat._apply_hunks("unchanged\n", [hunk]), "unchanged\n")


class MergeVerdicts(unittest.TestCase):
    def test_all_allow_merges_to_allow(self):
        result = claude_compat._merge([("A.kt", "allow", None), ("B.kt", "allow", None)])
        self.assertIsNone(result)

    def test_one_deny_wins_and_is_path_prefixed(self):
        result = claude_compat._merge([
            ("Clean.kt", "allow", None),
            ("Bad.kt", "deny", "[no-force-unwrap] line 3: banned"),
        ])
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertEqual(reason, "Bad.kt: [no-force-unwrap] line 3: banned")
        self.assertEqual(result["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_multi_line_deny_reason_prefixes_every_line(self):
        result = claude_compat._merge([
            ("Bad.kt", "deny", "[rule-a] line 1: one\n[rule-b] line 2: two"),
        ])
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertEqual(reason, "Bad.kt: [rule-a] line 1: one\nBad.kt: [rule-b] line 2: two")

    def test_autofix_degrades_to_deny_with_roadmap_reason(self):
        result = claude_compat._merge([("Fixable.kt", "autofix", {"content": "fixed"})])
        self.assertEqual(result["hookSpecificOutput"]["permissionDecision"], "deny")
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertTrue(reason.startswith("Fixable.kt: "))
        self.assertIn("Codex v1", reason)

    def test_deny_wins_over_autofix_across_different_files(self):
        result = claude_compat._merge([
            ("Fixable.kt", "autofix", {"content": "fixed"}),
            ("Bad.kt", "deny", "no good"),
        ])
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("Bad.kt: no good", reason)
        self.assertIn("Fixable.kt:", reason)


class EvaluateMockedCoreInvocation(unittest.TestCase):
    """The task's required 'sample envelopes' cases: a 3-file batch and a
    malformed envelope. _invoke_core is mocked so these stay fast and do not
    depend on real on-disk state beyond the one Update file the projection
    step must genuinely read."""

    def test_three_file_batch_mixed_verdicts_merge_to_one_deny(self):
        workspace = Path(tempfile.mkdtemp())
        updated = workspace / "B.kt"
        updated.write_text("val b = 1\nold line\n", encoding="utf-8")

        text = (
            "*** Begin Patch\n"
            f"*** Add File: {workspace}/A.kt\n"
            "+val a = 1\n"
            f"*** Update File: {updated}\n"
            "@@\n"
            " val b = 1\n"
            "-old line\n"
            "+new line\n"
            f"*** Delete File: {workspace}/C.kt\n"
            "*** End Patch\n"
        )
        payload = {"tool_name": "apply_patch", "tool_input": {"command": text}}

        def fake_invoke(write_input):
            if write_input["file_path"] == str(updated):
                return "deny", "[no-force-unwrap] line 2: banned"
            return "allow", None

        with mock.patch.object(claude_compat, "_invoke_core", side_effect=fake_invoke):
            result = claude_compat.evaluate(payload)

        self.assertIsNotNone(result)
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertEqual(reason, f"{updated}: [no-force-unwrap] line 2: banned")

    def test_three_file_batch_all_clean_allows(self):
        workspace = Path(tempfile.mkdtemp())
        updated = workspace / "B.kt"
        updated.write_text("val b = 1\nold line\n", encoding="utf-8")

        text = (
            "*** Begin Patch\n"
            f"*** Add File: {workspace}/A.kt\n"
            "+val a = 1\n"
            f"*** Update File: {updated}\n"
            "@@\n"
            " val b = 1\n"
            "-old line\n"
            "+new line\n"
            f"*** Delete File: {workspace}/C.kt\n"
            "*** End Patch\n"
        )
        payload = {"tool_name": "apply_patch", "tool_input": {"command": text}}

        with mock.patch.object(claude_compat, "_invoke_core", return_value=("allow", None)):
            result = claude_compat.evaluate(payload)

        self.assertIsNone(result)

    def test_malformed_envelope_is_silent_allow(self):
        # No apply_patch tool_name at all.
        self.assertIsNone(claude_compat.evaluate({"tool_name": "Bash", "tool_input": {"command": "ls"}}))
        # apply_patch tool_name but garbage command text.
        self.assertIsNone(claude_compat.evaluate({
            "tool_name": "apply_patch",
            "tool_input": {"command": "not a patch at all"},
        }))
        # A patch marker present but no recognizable file headers inside it.
        self.assertIsNone(claude_compat.evaluate({
            "tool_name": "apply_patch",
            "tool_input": {"command": "*** Begin Patch\n*** End Patch\n"},
        }))


class EvaluateRealCoreInvocation(unittest.TestCase):
    """One non-mocked pass through the real chain: real ast-grep, real core
    pretooluse.py subprocess, real on-disk hunk application."""

    def test_update_introducing_force_unwrap_denies_for_real(self):
        workspace = Path(tempfile.mkdtemp())
        _write_tenets(workspace)
        target = workspace / "Real.kt"
        target.write_text("package com.example\n\nval safe = 1\n", encoding="utf-8")

        text = (
            "*** Begin Patch\n"
            f"*** Update File: {target}\n"
            "@@\n"
            "-val safe = 1\n"
            "+val unsafe = maybeNull!!\n"
            "*** End Patch\n"
        )
        payload = {"tool_name": "apply_patch", "tool_input": {"command": text}}

        result = claude_compat.evaluate(payload)

        self.assertIsNotNone(result)
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn(str(target), reason)
        self.assertIn("no-force-unwrap", reason)

    def test_clean_update_allows_for_real(self):
        workspace = Path(tempfile.mkdtemp())
        _write_tenets(workspace)
        target = workspace / "RealClean.kt"
        target.write_text("package com.example\n\nval a = 1\n", encoding="utf-8")

        text = (
            "*** Begin Patch\n"
            f"*** Update File: {target}\n"
            "@@\n"
            "-val a = 1\n"
            "+val a = 2\n"
            "*** End Patch\n"
        )
        payload = {"tool_name": "apply_patch", "tool_input": {"command": text}}

        self.assertIsNone(claude_compat.evaluate(payload))


if __name__ == "__main__":
    unittest.main()
