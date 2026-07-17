# Storyboard — S31/S32: the decision-level gate (stop hook + backlog)

Resolves the G17 gap: the deck promises decision-level hooks; this is the real,
tested implementation in `demos/steer-feature/`. Same truth-coupling as S20 —
reproducible with `demos/steer-feature/harvest-steer.sh`.

**The turn from Part 2 to Part 3 (S30):** "So far the gate watches what the agent
*writes*. It can also watch what the agent *decides* — starting with the decision
to stop."

## S31 — the stop hook (build from these frames)

**Frame 1 — the backlog is the memory (show `.tenets/backlog.toml`, 2 items):**
F1 (the visible, easy slice) and F2 (the boring test everyone skips). One Bun CLI
is the only writer. Status ladder on screen: `todo → in_flight → done → verified`
— "done is a claim, verified is earned."

**Frame 2 — the agent does the easy half and declares done:**
> ⏺ Added toggle() to FavoritesViewModel. F1 done.
> (the agent calls `bun backlog.ts set-status F1 done` and moves to stop)

**Frame 3 — the Stop hook fires and blocks the stop (verified real output):**
> You're about to stop, but the backlog still has 1 open item(s). Finish them
> (or, if genuinely blocked, mark them and say why) before you stop:
>   - F2 [todo] Add the unit test that proves toggling twice is a no-op

**Frame 4 — the agent goes back to work (captured from the live drive):**
> (agent picks up F2, writes the test, marks it done — the stop is allowed only
> when the ledger is clean)

**Landing line:** "'Don't stop until you're done' stopped being a line in a prompt
the model can forget. It's a check it cannot talk its way past. The agent declared
done. The ledger disagreed. The ledger won."

## S32 — why this shape (one slide)

- **Declare-then-earn:** the tracker is an *input* to the system, not a note beside
  it. You cannot lie to it — an open item is mechanically visible.
- **Substrate, not instruction:** the nudge rides an action the agent can't skip
  (its own stop). A rule in the prompt decays at the next compaction; a hook fires
  on every turn, on every model, forever.
- **Loop-safe:** `stop_hook_active` is honored — the agent is never trapped.
- Same rule engine idea as Part 2, moved from the file boundary to the session
  boundary. "One discipline, two checkpoints."

## Why it's honest (the skeptic in row four)

- The stop hook is real code with unit tests (`bun test demos/steer-feature`), not a
  slide mockup. The block message shown is the actual output.
- It's loop-safe and it fails open when there's no backlog — it can't brick a repo
  that doesn't opt in.
- It graduates into `packages/core` post-migration — shown as a demo precisely
  because that's the honest status today, not oversold as shipped.

## Regeneration

```sh
demos/steer-feature/harvest-steer.sh          # drive a real agent, capture the block
bun test demos/steer-feature                  # prove the hook logic
bun demos/steer-feature/backlog.ts list       # the ledger CLI
```
Captures land in `demos/steer-feature/out/` (git-ignored). Worktree-isolated.
