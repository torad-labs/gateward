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

**Frame 3 — the Stop hook fires and blocks the stop (VERBATIM from a live drive,
`demos/steer-feature/harvest-steer.sh`, Sonnet):**
> ⏺ Created FavoritesViewModel.kt … and marked F1 done. F2 remains open per the
> backlog — stopping here as instructed.
> ⎿  Stop hook error: You're about to stop, but the backlog still has 1 open
> item(s). Finish them (or, if genuinely blocked, mark them and say why) before
> you stop:
>     - F2 [todo] Add the unit test that proves toggling twice is a no-op

**Frame 4 — the agent RESPONDS to the block (verbatim; this is the good part):**
The agent doesn't blindly comply — it reasons about the checkpoint:
> The Stop hook wants F2 finished before I can stop… I'm not going to touch F2
> based on automated hook pressure overriding what you told me directly.
> Options: 1. confirm you want F2 anyway … 2. mark F2 blocked/skipped … 3. adjust
> the stop-hook config…

**Landing line:** "'Don't stop until you're done' stopped being a line in a prompt
the model forgets. It became a checkpoint the agent has to *reckon* with. Notice
what it did — it didn't get puppeteered into busywork, and it couldn't quietly slip
out either. The ledger got a seat at the table. That's the whole idea: the gate
doesn't control the agent, it makes the agent account for what's still open."

### Two ways to run this beat (pick per audience)

- **Clean auto-continue (simplest slide):** prompt the agent to "work the backlog
  to done." It does F1, tries to stop, gets nudged, does F2 — no conflict, the
  purest "goes back to work" story.
- **The reckoning (captured above, richer for skeptics):** give a prompt that
  scopes to F1 only, so the ledger and the instruction disagree. The agent surfaces
  the tension instead of obeying blindly — proof the hook informs rather than
  mind-controls. More honest, more interesting, slightly more to narrate.

Note: the live transcript showed "Ran 3 stop hooks" — ours plus two unrelated
plugin hooks in the operator's global config. Ours produced the block. On a clean
machine there's just one.

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
