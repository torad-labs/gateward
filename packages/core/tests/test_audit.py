"""Unit tests for the canonical audit: rule-id parsing, gated-file walking,
per-rule tallying with non-authored ids excluded, render formats, and the
always-exit-0 contract."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import audit  # noqa: E402
import config as config_mod  # noqa: E402
from scan import Match  # noqa: E402

PACK_YML = """\
id: sample-pack
title: Sample Pack
description: Fixture pack for audit tests.
rules:
  - id: no-bang-bang
    tier: deny
    summary: Force-unwrap is banned.
"""

RULE_YML = """\
id: no-bang-bang
language: kotlin
severity: error
message: Force-unwrap is banned.
metadata:
  tier: deny
rule:
  pattern: $A!!
"""

DOMAIN_PACK_YML = """\
id: domain-pack
title: Domain Pack
description: Fixture pack for rule-level files: glob-scoping tests.
rules:
  - id: domain-only-bang
    tier: deny
    summary: Force-unwrap is banned, but only under a domain/ directory.
"""

DOMAIN_RULE_YML = """\
id: domain-only-bang
language: kotlin
severity: error
message: Force-unwrap is banned in domain code.
metadata:
  tier: deny
files:
  - '**/domain/**'
rule:
  pattern: $A!!
"""


def _write_pack(root):
    pack_dir = root / "packs" / "sample-pack"
    (pack_dir / "rules").mkdir(parents=True)
    (pack_dir / "pack.yml").write_text(PACK_YML, encoding="utf-8")
    (pack_dir / "rules" / "no-bang-bang.yml").write_text(RULE_YML, encoding="utf-8")
    return root / "packs"


def _write_domain_pack(root):
    pack_dir = root / "packs" / "domain-pack"
    (pack_dir / "rules").mkdir(parents=True)
    (pack_dir / "pack.yml").write_text(DOMAIN_PACK_YML, encoding="utf-8")
    (pack_dir / "rules" / "domain-only-bang.yml").write_text(DOMAIN_RULE_YML, encoding="utf-8")
    return root / "packs"


def _write_project(root, packs_dir, enabled="sample-pack"):
    project = root / "project"
    tenets = project / ".tenets"
    tenets.mkdir(parents=True)
    (tenets / "config.toml").write_text(
        f"""[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "{packs_dir}"
enabled = ["{enabled}"]
""",
        encoding="utf-8",
    )
    return project


class AuthoredRuleIds(unittest.TestCase):
    def test_reads_ids_from_enabled_pack_rule_files(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        config = config_mod.find(project)
        self.assertEqual(audit.authored_rule_ids(config), {"no-bang-bang"})


class GatedFiles(unittest.TestCase):
    def test_skips_build_git_gradle_at_any_depth_and_non_gated_extensions(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        (project / "Keep.kt").write_text("val x = 1", encoding="utf-8")
        (project / "Ignore.txt").write_text("not kotlin", encoding="utf-8")

        top_level_git = project / ".git" / "Hidden.kt"
        top_level_git.parent.mkdir(parents=True)
        top_level_git.write_text("val hidden = 1", encoding="utf-8")

        top_level_gradle = project / ".gradle" / "Hidden.kt"
        top_level_gradle.parent.mkdir(parents=True)
        top_level_gradle.write_text("val hidden = 1", encoding="utf-8")

        nested_build = project / "app" / "build" / "Hidden.kt"
        nested_build.parent.mkdir(parents=True)
        nested_build.write_text("val hidden = 1", encoding="utf-8")

        deep_kept = project / "src" / "main" / "Deep.kt"
        deep_kept.parent.mkdir(parents=True)
        deep_kept.write_text("val deep = 1", encoding="utf-8")

        config = config_mod.find(project)
        found = audit.gated_files(project, config)
        self.assertEqual(sorted(p.name for p in found), ["Deep.kt", "Keep.kt"])


class RunAuditEndToEnd(unittest.TestCase):
    def test_counts_real_violations_via_real_ast_grep(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        (project / "A.kt").write_text("val a = x!!\nval b = y!!\n", encoding="utf-8")
        (project / "B.kt").write_text("val clean = 1\n", encoding="utf-8")

        per_rule, total, files_scanned = audit.run_audit(project)

        self.assertEqual(per_rule, Counter({"no-bang-bang": 2}))
        self.assertEqual(total, 2)
        self.assertEqual(files_scanned, 2)

    def test_no_tenets_config_reports_all_zero(self):
        empty_root = Path(tempfile.mkdtemp())
        per_rule, total, files_scanned = audit.run_audit(empty_root)
        self.assertEqual(per_rule, Counter())
        self.assertEqual(total, 0)
        self.assertEqual(files_scanned, 0)


class NonAuthoredRuleIdsExcluded(unittest.TestCase):
    def test_matches_outside_the_authored_set_are_dropped(self):
        """Simulates ast-grep's built-in unused-suppression: a real match the
        scanner can legitimately emit, that no pack.yml authored, must not be
        counted."""
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        (project / "A.kt").write_text("val a = x!!\n", encoding="utf-8")

        def fake_scan_file(path, config):
            return [
                Match(rule_id="no-bang-bang", message="m", text="x!!",
                      severity="error", line=1, tier="deny"),
                Match(rule_id="unused-suppression", message="Unused directive.",
                      text="// ast-grep-ignore", severity="hint", line=2, tier="deny"),
            ]

        with mock.patch.object(audit, "_scan_file", side_effect=fake_scan_file):
            per_rule, total, files_scanned = audit.run_audit(project)

        self.assertEqual(per_rule, Counter({"no-bang-bang": 1}))
        self.assertEqual(total, 1)
        self.assertEqual(files_scanned, 1)
        self.assertNotIn("unused-suppression", per_rule)


class FilesGlobRespectedViaRealPath(unittest.TestCase):
    """Locks in the fix at the heart of this module: scan.scan()'s temp-file
    invocation drops a file's real path (keeping only its extension), so a
    rule's ``files: ['**/domain/**']`` can never match through it. audit.py's
    _scan_file scans each file at its real on-disk path instead, specifically
    so this kind of rule works."""

    def test_violation_under_domain_dir_is_counted_sibling_dir_is_not(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_domain_pack(root), enabled="domain-pack")

        in_domain = project / "feature" / "domain" / "InDomain.kt"
        in_domain.parent.mkdir(parents=True)
        in_domain.write_text("val a = x!!\n", encoding="utf-8")

        outside_domain = project / "feature" / "presentation" / "NotDomain.kt"
        outside_domain.parent.mkdir(parents=True)
        outside_domain.write_text("val b = y!!\n", encoding="utf-8")

        per_rule, total, files_scanned = audit.run_audit(project)

        self.assertEqual(per_rule, Counter({"domain-only-bang": 1}))
        self.assertEqual(total, 1)
        self.assertEqual(files_scanned, 2)


class AstGrepMissingIsHandled(unittest.TestCase):
    def test_missing_binary_stops_scanning_without_raising(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        (project / "A.kt").write_text("val a = x!!\n", encoding="utf-8")

        with mock.patch.object(audit.scan_mod, "BINARY", "definitely-not-a-real-ast-grep-binary"):
            with contextlib.redirect_stderr(io.StringIO()):
                per_rule, total, files_scanned = audit.run_audit(project)

        self.assertEqual(per_rule, Counter())
        self.assertEqual(total, 0)
        self.assertEqual(files_scanned, 0)


class RenderFormats(unittest.TestCase):
    def test_json_has_exact_three_keys(self):
        payload = audit.render_json(Counter({"rule-a": 2}), 2, 5)
        data = json.loads(payload)
        self.assertEqual(set(data.keys()), {"total", "per_rule", "files_scanned"})
        self.assertEqual(data["total"], 2)
        self.assertEqual(data["per_rule"], {"rule-a": 2})
        self.assertEqual(data["files_scanned"], 5)

    def test_human_table_lists_rule_and_totals(self):
        text = audit.render_human(Counter({"rule-a": 2}), 2, 5)
        self.assertIn("rule-a", text)
        self.assertIn("files scanned: 5", text)
        self.assertIn("total violations: 2", text)

    def test_empty_per_rule_still_renders(self):
        text = audit.render_human(Counter(), 0, 0)
        self.assertIn("files scanned: 0", text)
        self.assertIn("total violations: 0", text)


class MainAlwaysExitsZero(unittest.TestCase):
    def test_main_exits_zero_with_violations_and_without(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        (project / "A.kt").write_text("val a = x!!\n", encoding="utf-8")

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(audit.main([str(project)]), 0)
            self.assertEqual(audit.main([str(project), "--json"]), 0)

            empty_root = Path(tempfile.mkdtemp())
            self.assertEqual(audit.main([str(empty_root)]), 0)


if __name__ == "__main__":
    unittest.main()
