"""Unit tests for projection: Write is content-as-is; Edit is replayed against
the on-disk file; anything undecidable returns None (silent allow)."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import projection  # noqa: E402


class WriteProjection(unittest.TestCase):
    def test_new_file_content_as_is_with_empty_current(self):
        target = Path(tempfile.mkdtemp()) / "New.kt"
        result = projection.project("Write", {"file_path": str(target), "content": "val x = 1\n"})
        self.assertEqual(result.tool_name, "Write")
        self.assertEqual(result.current, "")
        self.assertEqual(result.projected, "val x = 1\n")

    def test_existing_file_supplies_current(self):
        target = _write_temp("old body\n")
        result = projection.project("Write", {"file_path": str(target), "content": "new body\n"})
        self.assertEqual(result.current, "old body\n")
        self.assertEqual(result.projected, "new body\n")

    def test_missing_content_is_not_ours(self):
        self.assertIsNone(projection.project("Write", {"file_path": "/tmp/x.kt"}))


class EditProjection(unittest.TestCase):
    def test_first_occurrence_only_by_default(self):
        target = _write_temp("a a a")
        result = projection.project("Edit", {"file_path": str(target), "old_string": "a", "new_string": "b"})
        self.assertEqual(result.projected, "b a a")
        self.assertEqual(result.current, "a a a")

    def test_replace_all(self):
        target = _write_temp("a a a")
        result = projection.project(
            "Edit",
            {"file_path": str(target), "old_string": "a", "new_string": "b", "replace_all": True},
        )
        self.assertEqual(result.projected, "b b b")

    def test_old_string_absent_is_undecidable(self):
        target = _write_temp("hello")
        self.assertIsNone(
            projection.project("Edit", {"file_path": str(target), "old_string": "zzz", "new_string": "y"})
        )

    def test_missing_file_is_undecidable(self):
        missing = Path(tempfile.mkdtemp()) / "Absent.kt"
        self.assertIsNone(
            projection.project("Edit", {"file_path": str(missing), "old_string": "a", "new_string": "b"})
        )

    def test_empty_old_string_is_undecidable(self):
        target = _write_temp("hello")
        self.assertIsNone(
            projection.project("Edit", {"file_path": str(target), "old_string": "", "new_string": "y"})
        )


class NotOurs(unittest.TestCase):
    def test_unknown_tool(self):
        self.assertIsNone(projection.project("Bash", {"command": "ls"}))

    def test_missing_file_path(self):
        self.assertIsNone(projection.project("Write", {"content": "x"}))


def _write_temp(body):
    target = Path(tempfile.mkdtemp()) / "File.kt"
    target.write_text(body, encoding="utf-8")
    return target


if __name__ == "__main__":
    unittest.main()
