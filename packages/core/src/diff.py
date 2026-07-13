"""Only-new-violations diff.

A gate that blocked on *every* finding would make the first edit to any legacy
file impossible. Instead the finding multiset of the current file is compared to
that of the projected file, keyed by ``(rule id, matched text)``: a finding is
new only when its projected count exceeds its current count. Pre-existing
findings never block; re-introducing the same violation a second time does.
"""
from collections import Counter


def new_violations(current, projected):
    """Return the projected matches that are new relative to ``current``.

    ``current`` and ``projected`` are lists of :class:`scan.Match`. The result
    preserves projected order and holds exactly ``projected_count -
    current_count`` matches for each ``(rule id, text)`` key.
    """
    baseline = Counter((match.rule_id, match.text) for match in current)
    seen = Counter()
    fresh = []
    for match in projected:
        key = (match.rule_id, match.text)
        seen[key] += 1
        if seen[key] > baseline.get(key, 0):
            fresh.append(match)
    return fresh
