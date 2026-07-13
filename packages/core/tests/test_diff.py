"""Unit tests for the only-new-violations multiset diff."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import diff  # noqa: E402
from scan import Match  # noqa: E402


def match(rule_id, text):
    return Match(rule_id=rule_id, message="m", text=text, severity="error", line=1, tier="deny")


class NewViolations(unittest.TestCase):
    def test_new_file_every_finding_is_new(self):
        projected = [match("no-force-unwrap", "a!!")]
        fresh = diff.new_violations([], projected)
        self.assertEqual([m.text for m in fresh], ["a!!"])

    def test_unchanged_findings_do_not_block(self):
        current = [match("no-force-unwrap", "a!!")]
        projected = [match("no-force-unwrap", "a!!")]
        self.assertEqual(diff.new_violations(current, projected), [])

    def test_edit_adds_one_distinct_violation(self):
        current = [match("no-force-unwrap", "a!!"), match("no-force-unwrap", "b!!")]
        projected = current + [match("no-force-unwrap", "c!!")]
        fresh = diff.new_violations(current, projected)
        self.assertEqual([m.text for m in fresh], ["c!!"])

    def test_multiset_counts_a_repeated_text_as_new(self):
        current = [match("no-force-unwrap", "x!!")]
        projected = [match("no-force-unwrap", "x!!"), match("no-force-unwrap", "x!!")]
        fresh = diff.new_violations(current, projected)
        self.assertEqual(len(fresh), 1)
        self.assertEqual(fresh[0].text, "x!!")

    def test_removing_a_legacy_violation_yields_nothing_new(self):
        current = [match("no-force-unwrap", "a!!"), match("no-force-unwrap", "b!!")]
        projected = [match("no-force-unwrap", "a!!")]
        self.assertEqual(diff.new_violations(current, projected), [])

    def test_same_text_different_rule_is_a_distinct_key(self):
        current = [match("rule-a", "token")]
        projected = [match("rule-a", "token"), match("rule-b", "token")]
        fresh = diff.new_violations(current, projected)
        self.assertEqual([(m.rule_id, m.text) for m in fresh], [("rule-b", "token")])


if __name__ == "__main__":
    unittest.main()
