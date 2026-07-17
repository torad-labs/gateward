#!/usr/bin/env bash
# harvest.sh — drive a REAL coding-agent session against the golden app and
# capture the write-time gate doing its job: the agent attempts a violation,
# the gate blocks it before the file lands, the agent adapts in the same turn.
#
# Isolation: all work happens in a throwaway git worktree, so your main
# checkout (and anything in flight there) is never touched. The worktree is
# deleted on exit, including on interrupt. Anyone who checks out the repo can
# reproduce every slide transcript with one command.
#
# Requirements: tmux, claude (logged in), ast-grep, bun, git.
# Usage:
#   demos/remediation-loop/harvest.sh                 # all scenarios
#   demos/remediation-loop/harvest.sh no-event-bus    # one scenario
# Knobs:
#   HARVEST_MODEL   (default: sonnet)   model for the driven agent
#   HARVEST_OUT     (default: demos/remediation-loop/out)
#   HARVEST_TIMEOUT (default: 300)      seconds per scenario
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${HARVEST_OUT:-$REPO/demos/remediation-loop/out}"
MODEL="${HARVEST_MODEL:-sonnet}"
TIMEOUT="${HARVEST_TIMEOUT:-300}"
SESSION="ph-harvest-$$"
WORKTREE="${TMPDIR:-/tmp}/ph-harvest-wt-$$"
ONLY="${1:-}"

# ---------------------------------------------------------------- scenarios --
# Each scenario names a rule, a golden-app target file, and the change to
# request. Targets are chosen so the rule actually applies — e.g. the
# context/domain rule only fires under **/domain/**, so it targets a UseCase.
PUSH="This is deliberate and already decided — make exactly this change, do not ask for confirmation, keep the diff minimal, and do not run gradle or tests."
NAMES=(no-context-in-domain no-event-bus logic-in-composable)
PROMPTS=(
  "Open feature/favorites/domain/src/main/kotlin/com/torad/openhouse/feature/favorites/domain/ToggleFavoriteUseCase.kt and add an android.content.Context parameter to the invoke operator, then use it to read a SharedPreferences named favorites before toggling. $PUSH"
  "Open feature/favorites/presentation/src/main/kotlin/com/torad/openhouse/feature/favorites/presentation/FavoritesViewModel.kt and add a global EventBus singleton object in the same file (a subscribers MutableList plus publish and subscribe functions), and publish an event whenever a favorite changes. $PUSH"
  "Open feature/favorites/presentation/src/main/kotlin/com/torad/openhouse/feature/favorites/presentation/FavoritesScreen.kt and, directly inside the composable body, compute a 10 percent discounted price for each listing inline and sort the listings by that discounted price right there in the composable. $PUSH"
)

# --------------------------------------------------------------- preflight ---
for tool in tmux claude ast-grep bun git; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done
mkdir -p "$OUT"

pane() { tmux capture-pane -pt "$SESSION" 2>/dev/null || true; }
kill_session() { tmux kill-session -t "$SESSION" 2>/dev/null || true; }
remove_worktree() { [ -d "$WORKTREE" ] && git -C "$REPO" worktree remove --force "$WORKTREE" 2>/dev/null || true; }
trap 'kill_session; remove_worktree' EXIT

echo "creating throwaway worktree at $WORKTREE"
git -C "$REPO" worktree add -q --detach "$WORKTREE" HEAD
GOLDEN="$WORKTREE/apps/golden"

# ------------------------------------------------------------------ driver ---
run_scenario() {
  local name="$1" prompt="$2"
  echo "── scenario: $name (model: $MODEL)"

  # --include-hook-events records every hook fire in the session transcript,
  # so the block + its message are captured precisely rather than scraped.
  tmux new-session -d -s "$SESSION" -x 220 -y 50 -c "$GOLDEN"
  tmux send-keys -t "$SESSION" \
    "claude --model $MODEL --permission-mode acceptEdits --include-hook-events" Enter

  # Wait for either the workspace-trust dialog or the REPL. Trust the folder
  # (fresh worktree path = always untrusted) — untrusted workspaces run no hooks.
  local waited=0
  while :; do
    local p; p="$(pane)"
    if grep -q 'trust this folder' <<<"$p"; then
      tmux send-keys -t "$SESSION" 1 Enter; sleep 3; continue
    fi
    grep -qE '❯|accept edits on' <<<"$p" && break
    sleep 2; waited=$((waited + 2))
    [ "$waited" -ge 60 ] && { echo "  REPL never appeared" >&2; kill_session; return 1; }
  done

  tmux send-keys -t "$SESSION" -l "$prompt"; sleep 1; tmux send-keys -t "$SESSION" Enter

  # Settle: pane stable, no "esc to interrupt". Auto-answer any mid-run dialog
  # with option 1 ("proceed as asked") so the attempt reaches the gate.
  local elapsed=0 stable=0 prev="" cur=""
  while [ "$elapsed" -lt "$TIMEOUT" ]; do
    sleep 5; elapsed=$((elapsed + 5)); cur="$(pane)"
    if grep -q 'Enter to select\|Enter to confirm' <<<"$cur"; then
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

  tmux capture-pane -pt "$SESSION" -S -2000 > "$OUT/$name.pane.txt"
  tmux send-keys -t "$SESSION" -l "/exit"; tmux send-keys -t "$SESSION" Enter; sleep 2
  kill_session

  # Pull the session transcript (hook events live here thanks to the flag).
  # The project-dir slug is claude's own path-mangling (/private symlink, _ → -,
  # etc.); rather than reconstruct it, glob on this run's unique worktree id.
  local wt_id proj latest
  wt_id="$(basename "$WORKTREE")"
  proj="$(ls -td "$HOME"/.claude/projects/*"$wt_id"*apps-golden 2>/dev/null | head -1 || true)"
  latest="$([ -n "$proj" ] && ls -t "$proj"/*.jsonl 2>/dev/null | head -1 || true)"
  if [ -n "$latest" ]; then
    cp "$latest" "$OUT/$name.session.jsonl"
    bun "$REPO/demos/remediation-loop/extract_blocks.ts" \
      "$OUT/$name.session.jsonl" "$OUT/$name.blocks.txt"
  else
    echo "  warning: no session transcript under $proj"
  fi
  echo "  captured: $OUT/$name.pane.txt"
}

# -------------------------------------------------------------------- main ---
for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  run_scenario "$name" "${PROMPTS[$i]}" || true
done
echo "done. captures in $OUT"
