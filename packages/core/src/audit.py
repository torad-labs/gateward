#!/usr/bin/env python3
"""Canonical repository-wide rule-violation audit.

Run as ``python3 packages/core/src/audit.py <project-root> [--json]``.

This is not a gate — it is a report. Where ``events/pretooluse.py`` judges one
projected edit, this command scans a project's *entire current on-disk state*:
it resolves ``.tenets/config.toml`` exactly like the hook does (:mod:`config`'s
enabled packs, ``default_enabled``, per-rule ``tier``/``enabled`` overrides,
and each rule's own ``files:``/``ignores:`` scoping), walks every file the
project gates by extension (skipping ``build/``, ``.git/``, ``.gradle/`` at
any depth), and tallies ast-grep matches per rule id.

**This command defines THE canonical audit number.** CI pins its output and
the stage quotes it verbatim, so the count must be stable, reproducible, and
actually correct — not an approximation.

Why this does not call ``scan.scan()`` directly
------------------------------------------------
:func:`scan.scan` is built for the hook's job: judging *hypothetical* content
(a Write/Edit payload's projected result) that may not match anything on disk,
so it copies that content into a throwaway ``tempfile.mkstemp(...)`` path
before invoking ast-grep. That copy keeps only the file's extension — never
its real directory — because the hook has no reason to care what the path
looks like.

This audit's content is never hypothetical: every file it scans already
exists on disk at its real path. Routing it through the same temp-file copy
would throw that real path away for no reason, and several authored rules
depend on it: ``no-android-import-in-domain`` and ``no-context-in-domain``
carry ``files: ['**/domain/**']``, ``test-names-given-when-then`` carries
``files: ['**/test/**']``, and ``no-runblocking-in-main`` carries
``ignores: ['**/test/**', '**/androidTest/**']``. ast-grep matches those globs
against the path it is given — ``/tmp/tmpXXXXXX.kt`` never contains a
``domain`` or ``test`` segment, so none of those four rules can ever fire
through the hook's temp-file path (verified empirically: scanning
``ListingsRepositoryTest.kt`` in place finds 2 ``test-names-given-when-then``
matches; scanning a ``/tmp`` copy of the identical content finds 0). That is a
real, pre-existing gap in ``scan.py``'s hook-oriented invocation — out of this
module's file fence to change — not a defect introduced here. :func:`_scan_file`
below reuses :mod:`scan`'s rule-loading and subprocess plumbing
(``scan._inline_rules``, ``scan._exec``, ``scan.Match``, ``scan.AstGrepMissing``)
but invokes ast-grep directly against each file's real path, the one thing
:func:`scan.scan` cannot do for its own use case.

Excluding ast-grep's own built-in diagnostics
----------------------------------------------
ast-grep ships built-in diagnostics that are not authored rules — e.g.
``unused-suppression`` (severity ``hint``), emitted in project/config-mode
scanning for a ``// ast-grep-ignore`` comment that did not actually suppress
anything. No pack.yml lists it, and it must never contribute to this audit's
count. The risk is not hypothetical: ``unused-suppression`` is evaluated per
rule *set*, so the same one suppression comment — written once, naming the
one rule it intends to silence — reads as "used" against the one pack that
owns that rule and "unused" against every other pack scanned separately,
multiplying a single comment into several diagnostic hits (a real triple
count across this product's other three packs, confirmed against a live
0.44.0 binary). Scanning with an enabled project's packs merged into one
``--inline-rules`` call (what both :func:`scan.scan` and :func:`_scan_file`
do) avoids that multiplication in practice — inline-rules mode does not
appear to compute this diagnostic at all — but this command does not lean on
that as its guarantee: it builds an explicit allowlist of rule ids actually
authored in the project's enabled packs (each rule file's own ``id:`` field)
and discards any match whose rule id is not in that set, regardless of which
diagnostic produced it or how the scan was invoked.

Output
------
Human-readable table by default; ``--json`` prints
``{"total": int, "per_rule": {rule_id: count}, "files_scanned": int}``.
Rules with zero matches are omitted from ``per_rule`` (the report is a list
of what fired, not a full rule inventory).

Exit code is always 0 — this command reports, it does not pass/fail.
"""
import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config as config_mod  # noqa: E402
import scan as scan_mod  # noqa: E402

SKIP_DIRS = {"build", ".git", ".gradle"}


def authored_rule_ids(config):
    """The rule ids actually authored in ``config``'s enabled packs.

    Anything ast-grep reports that is not in this set — e.g. its built-in
    ``unused-suppression`` hint — is not one of ours and must not be counted.
    """
    ids = set()
    for rule_file in config.rule_files():
        rule_id = _rule_id(rule_file)
        if rule_id:
            ids.add(rule_id)
    return ids


def _rule_id(rule_file):
    """Read a rule YAML file's top-level ``id:`` field.

    Narrow line-oriented read, deliberately not a YAML parser — same style as
    :func:`config._pack_rule_defaults`: rule files are small and self-authored,
    and only the one top-level (column-0) ``id:`` line is ever needed.
    """
    for raw_line in rule_file.read_text(encoding="utf-8").splitlines():
        if raw_line.startswith("id:"):
            return raw_line[len("id:"):].strip()
    return None


def gated_files(root, config):
    """Every file under ``root`` this config gates, sorted for determinism.

    Walks the full tree under ``root`` (not just its top level), pruning
    ``build/``, ``.git/``, and ``.gradle/`` directories at any depth.
    """
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for filename in filenames:
            path = Path(dirpath) / filename
            if config.gates(path):
                found.append(path)
    return sorted(found)


def _scan_file(path, config):
    """Scan the real, on-disk file at ``path`` and return its enabled,
    tier-resolved :class:`scan.Match` list.

    See the module docstring ("Why this does not call scan.scan() directly")
    for why this exists instead of reusing :func:`scan.scan` outright: it
    invokes ast-grep against ``path`` itself rather than a temp-file copy, so
    rule-level ``files:``/``ignores:`` globs resolve against the file's real
    location. Everything else — rule text assembly, the enabled check, tier
    resolution — is the same logic :func:`scan.scan` applies.
    """
    rules = scan_mod._inline_rules(config)
    result = scan_mod._exec(["scan", "--inline-rules", rules, "--json=compact", str(path)])
    raw = json.loads(result.stdout or "[]")
    matches = []
    for item in raw:
        rule_id = item.get("ruleId", "")
        if not config.rule_enabled(rule_id):
            continue
        start = item.get("range", {}).get("start", {})
        matches.append(scan_mod.Match(
            rule_id=rule_id,
            message=item.get("message", rule_id),
            text=item.get("text", ""),
            severity=item.get("severity", "error"),
            line=start.get("line", -1) + 1,
            tier=config.tier_for(rule_id),
        ))
    return matches


def run_audit(project_root):
    """Scan ``project_root`` and return ``(per_rule, total, files_scanned)``.

    ``per_rule`` is a :class:`collections.Counter` keyed by rule id, holding
    only authored rules that actually matched (see module docstring). Returns
    all-zero when ``project_root`` has no ``.tenets/config.toml`` — same as
    the hook's "not installed here" allow.
    """
    config = config_mod.find(project_root)
    per_rule = Counter()
    if config is None:
        return per_rule, 0, 0

    allowed_ids = authored_rule_ids(config)
    files_scanned = 0
    for path in gated_files(project_root, config):
        try:
            matches = _scan_file(path, config)
        except scan_mod.AstGrepMissing:
            print(
                f"[audit] ast-grep is not installed; stopped after "
                f"{files_scanned} file(s) scanned.",
                file=sys.stderr,
            )
            break
        files_scanned += 1
        for match in matches:
            if match.rule_id in allowed_ids:
                per_rule[match.rule_id] += 1

    return per_rule, sum(per_rule.values()), files_scanned


def render_human(per_rule, total, files_scanned):
    lines = []
    width = max((len(rule_id) for rule_id in per_rule), default=len("rule"))
    lines.append(f"{'rule'.ljust(width)}  count")
    lines.append(f"{'-' * width}  -----")
    for rule_id in sorted(per_rule):
        lines.append(f"{rule_id.ljust(width)}  {per_rule[rule_id]}")
    lines.append("")
    lines.append(f"files scanned: {files_scanned}")
    lines.append(f"total violations: {total}")
    return "\n".join(lines)


def render_json(per_rule, total, files_scanned):
    return json.dumps({
        "total": total,
        "per_rule": dict(sorted(per_rule.items())),
        "files_scanned": files_scanned,
    })


def main(argv=None):
    parser = argparse.ArgumentParser(description=(__doc__ or "Canonical audit").splitlines()[0])
    parser.add_argument("project_root", help="Directory containing (or under) .tenets/")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args(argv)

    per_rule, total, files_scanned = run_audit(args.project_root)
    if args.json:
        print(render_json(per_rule, total, files_scanned))
    else:
        print(render_human(per_rule, total, files_scanned))
    return 0


if __name__ == "__main__":
    sys.exit(main())
