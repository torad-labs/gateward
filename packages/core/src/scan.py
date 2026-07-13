"""ast-grep invocation and result modelling.

The core never parses rule YAML: it hands the enabled rule files to the ast-grep
binary and reads back compact JSON. ``ast-grep scan`` exits non-zero when it
finds matches, so the return code is ignored and stdout is parsed instead. Rule
*tier* is not present in that JSON (ast-grep does not surface rule metadata), so
tier is resolved from config — see :meth:`config.Config.tier_for`.
"""
import json
import subprocess
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

BINARY = "ast-grep"
_TIMEOUT_SECONDS = 30


class AstGrepMissing(Exception):
    """Raised when the ast-grep binary is not on PATH."""


@dataclass(frozen=True)
class Match:
    """One rule match, with its tier resolved from config."""

    rule_id: str
    message: str
    text: str
    severity: str
    line: int  # 1-based
    tier: str


def scan(content, path, config):
    """Scan ``content`` with the project's enabled rules and return the enabled
    :class:`Match` list. Raises :class:`AstGrepMissing` when the binary is
    absent."""
    rules = _inline_rules(config)
    raw = _run(["scan", "--inline-rules", rules, "--json=compact"], content, path, config)
    matches = []
    for item in raw:
        rule_id = item.get("ruleId", "")
        if not config.rule_enabled(rule_id):
            continue
        start = item.get("range", {}).get("start", {})
        matches.append(Match(
            rule_id=rule_id,
            message=item.get("message", rule_id),
            text=item.get("text", ""),
            severity=item.get("severity", "error"),
            line=start.get("line", -1) + 1,
            tier=config.tier_for(rule_id),
        ))
    return matches


def apply_fix(content, path, config):
    """Return ``content`` with every fixable rule applied via ``--update-all``.

    Rules without a ``fix:`` change nothing, so this rewrites only autofix-tier
    matches. Raises :class:`AstGrepMissing` when the binary is absent.
    """
    rules = _inline_rules(config)
    with _temp_file(content, path, config) as tmp:
        _exec(["scan", "--inline-rules", rules, "--update-all", str(tmp)])
        return tmp.read_text(encoding="utf-8")


def _inline_rules(config):
    # Concatenate the enabled rule files verbatim into one --inline-rules
    # document. Reading the bytes is not parsing them: ast-grep owns rule
    # semantics; the core only shuttles the text.
    docs = [path.read_text(encoding="utf-8") for path in config.rule_files()]
    return "\n---\n".join(docs)


def _run(args, content, path, config):
    with _temp_file(content, path, config) as tmp:
        result = _exec([*args, str(tmp)])
        return json.loads(result.stdout or "[]")


def _exec(args):
    try:
        return subprocess.run(
            [BINARY, *args],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        raise AstGrepMissing() from error


@contextmanager
def _temp_file(content, path, config):
    # Mirror the file's project-relative path under a temp dir. Rule-level
    # files:/ignores: globs (e.g. **/domain/**, **/test/**) match on path
    # shape; a bare temp name would erase it and those rules could never fire.
    root = config.config_dir.parent.resolve()
    candidate = Path(path)
    try:
        rel = candidate.resolve().relative_to(root)
    except ValueError:
        rel = Path(candidate.name)
    with tempfile.TemporaryDirectory(prefix="portable-hooks-") as tmpdir:
        tmp = Path(tmpdir) / rel
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(content, encoding="utf-8")
        yield tmp
