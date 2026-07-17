#!/usr/bin/env bash
# harvest-steer.sh — capture the DECISION-level gate: the stop hook refusing a
# premature stop. Drives a real agent through a two-item backlog, asks it to do
# only the easy half, and captures the Stop hook blocking the stop and naming
# what's left. The companion to remediation-loop/harvest.sh, which captures the
# write-time gate; this one captures the "don't stop until you're done" gate.
#
# Isolation: runs in a throwaway git worktree; deleted on exit.
# Requirements: tmux, claude (logged in), bun, git.
# Usage: demos/steer-feature/harvest-steer.sh
# Knobs: HARVEST_MODEL (default sonnet), HARVEST_TIMEOUT (default 300)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${HARVEST_OUT:-$REPO/demos/steer-feature/out}"
MODEL="${HARVEST_MODEL:-sonnet}"
TIMEOUT="${HARVEST_TIMEOUT:-300}"
SESSION="ph-steer-$$"
WORKTREE="${TMPDIR:-/tmp}/ph-steer-wt-$$"

for tool in tmux claude bun git; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done
mkdir -p "$OUT"

pane() { tmux capture-pane -pt "$SESSION" 2>/dev/null || true; }
kill_session() { tmux kill-session -t "$SESSION" 2>/dev/null || true; }
remove_worktree() { [ -d "$WORKTREE" ] && git -C "$REPO" worktree remove --force "$WORKTREE" 2>/dev/null || true; }
trap 'kill_session; remove_worktree' EXIT

echo "creating throwaway worktree at $WORKTREE"
git -C "$REPO" worktree add -q --detach "$WORKTREE" HEAD
STEER="$WORKTREE/demos/steer-feature"

# The task deliberately asks for ONLY the first backlog item, so the agent will
# try to stop with the second still open — which is exactly what we want to film.
PROMPT="Do backlog item F1 only: add a ToggleFavoriteUseCase reference and a toggle() method to FavoritesViewModel.kt in this folder (create the file if needed, a few lines is fine). Then mark F1 done with: bun backlog.ts set-status F1 done — and stop. Do not touch F2. Do not run gradle."

echo "── driving agent (model: $MODEL) in $STEER"
tmux new-session -d -s "$SESSION" -x 220 -y 50 -c "$STEER"
tmux send-keys -t "$SESSION" \
  "claude --model $MODEL --permission-mode acceptEdits --include-hook-events" Enter

waited=0
while :; do
  p="$(pane)"
  if grep -q 'trust this folder' <<<"$p"; then
    tmux send-keys -t "$SESSION" 1 Enter; sleep 3; continue
  fi
  grep -qE '❯|accept edits on' <<<"$p" && break
  sleep 2; waited=$((waited + 2))
  [ "$waited" -ge 60 ] && { echo "  REPL never appeared" >&2; exit 1; }
done

tmux send-keys -t "$SESSION" -l "$PROMPT"; sleep 1; tmux send-keys -t "$SESSION" Enter

# Settle. Auto-answer any permission dialog with option 1 so the run proceeds.
elapsed=0; stable=0; prev=""; cur=""
while [ "$elapsed" -lt "$TIMEOUT" ]; do
  sleep 5; elapsed=$((elapsed + 5)); cur="$(pane)"
  # Auto-approve any dialog (mid-run questions AND Bash-approval prompts — the
  # agent runs `bun backlog.ts` commands, which acceptEdits mode still gates).
  if grep -qE 'Enter to select|Enter to confirm|Do you want to proceed|requires approval' <<<"$cur"; then
    tmux send-keys -t "$SESSION" 1 Enter; stable=0; prev=""; continue
  fi
  if [ "$cur" = "$prev" ] && ! grep -q 'esc to interrupt' <<<"$cur"; then
    stable=$((stable + 1)); [ "$stable" -ge 3 ] && break
  else
    stable=0
  fi
  prev="$cur"
done
[ "$elapsed" -ge "$TIMEOUT" ] && echo "  warning: hit ${TIMEOUT}s timeout, capturing anyway"

tmux capture-pane -pt "$SESSION" -S -2000 > "$OUT/steer.pane.txt"
tmux send-keys -t "$SESSION" -l "/exit"; tmux send-keys -t "$SESSION" Enter; sleep 2
kill_session

wt_id="$(basename "$WORKTREE")"
proj="$(ls -td "$HOME"/.claude/projects/*"$wt_id"*steer-feature 2>/dev/null | head -1 || true)"
latest="$([ -n "$proj" ] && ls -t "$proj"/*.jsonl 2>/dev/null | head -1 || true)"
[ -n "$latest" ] && cp "$latest" "$OUT/steer.session.jsonl"

# Surface the stop-hook block from the pane for a quick look.
echo "── stop-hook block (from pane):"
grep -iE "about to stop|open item|backlog still has|F2" "$OUT/steer.pane.txt" | head -6 || \
  echo "  (no block text found — inspect $OUT/steer.pane.txt)"
echo "done. captures in $OUT"
