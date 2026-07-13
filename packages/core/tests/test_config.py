"""Unit tests for default_enabled resolution: a pack.yml declares a rule's
default; .tenets/config.toml's per-rule table can override it either way."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import config as config_mod  # noqa: E402

PACK_YML = """\
id: sample-pack
title: Sample Pack
description: Fixture pack for default_enabled resolution tests.
rules:
  - id: rule-default-on
    tier: deny
    summary: Enabled unless a rule table disables it.
  - id: rule-default-off
    tier: deny
    default_enabled: false
    summary: Disabled unless a rule table enables it.
  - id: rule-explicit-on
    tier: deny
    default_enabled: true
    summary: Explicitly marked enabled in the pack manifest.
"""


def _write_pack(root):
    pack_dir = root / "packs" / "sample-pack"
    (pack_dir / "rules").mkdir(parents=True)
    (pack_dir / "pack.yml").write_text(PACK_YML, encoding="utf-8")
    return root / "packs"


def _write_project(root, packs_dir, extra_rules_toml=""):
    project = root / "project"
    tenets = project / ".tenets"
    tenets.mkdir(parents=True)
    (tenets / "config.toml").write_text(
        f"""[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "{packs_dir}"
enabled = ["sample-pack"]

{extra_rules_toml}
""",
        encoding="utf-8",
    )
    return project


class DefaultEnabledResolution(unittest.TestCase):
    def test_rule_with_no_pack_default_is_enabled(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        config = config_mod.find(project)
        self.assertTrue(config.rule_enabled("rule-default-on"))

    def test_rule_defaulting_off_in_pack_yml_is_disabled(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        config = config_mod.find(project)
        self.assertFalse(config.rule_enabled("rule-default-off"))

    def test_rule_explicitly_marked_default_enabled_true(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        config = config_mod.find(project)
        self.assertTrue(config.rule_enabled("rule-explicit-on"))

    def test_unmentioned_rule_id_defaults_enabled(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(root, _write_pack(root))
        config = config_mod.find(project)
        self.assertTrue(config.rule_enabled("some-other-rule-not-in-any-pack"))

    def test_config_toml_can_opt_a_default_off_rule_back_in(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(
            root, _write_pack(root),
            extra_rules_toml="[rules.rule-default-off]\nenabled = true\n",
        )
        config = config_mod.find(project)
        self.assertTrue(config.rule_enabled("rule-default-off"))

    def test_config_toml_override_still_disables_a_default_on_rule(self):
        root = Path(tempfile.mkdtemp())
        project = _write_project(
            root, _write_pack(root),
            extra_rules_toml="[rules.rule-default-on]\nenabled = false\n",
        )
        config = config_mod.find(project)
        self.assertFalse(config.rule_enabled("rule-default-on"))

    def test_missing_pack_yml_does_not_crash_and_defaults_enabled(self):
        root = Path(tempfile.mkdtemp())
        packs_dir = root / "packs"
        (packs_dir / "ghost-pack" / "rules").mkdir(parents=True)
        # No pack.yml written for ghost-pack.
        project = _write_project(root, packs_dir)
        # Point config.toml at a pack that has no pack.yml at all.
        (project / ".tenets" / "config.toml").write_text(
            f"""[core]
languages = ["kotlin"]
default_tier = "deny"

[packs]
packs_dir = "{packs_dir}"
enabled = ["ghost-pack"]
""",
            encoding="utf-8",
        )
        config = config_mod.find(project)
        self.assertTrue(config.rule_enabled("anything"))


if __name__ == "__main__":
    unittest.main()
