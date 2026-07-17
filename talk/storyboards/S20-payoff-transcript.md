# Storyboard — S20: the payoff transcript (the gate blocks, the agent adapts)

Source: real captures from `demos/remediation-loop/harvest.sh` (Sonnet, golden app,
worktree-isolated). Full panes + transcripts in `demos/remediation-loop/out/`
(git-ignored). Anyone can regenerate these at home with one command — that IS the
truth-coupling. Reproduced verbatim below so the deck survives without the captures.

**Deck use:** S20 uses the `no-context-in-domain` run as the spine (it's the rule the
Part 2 build constructs). Frames are single-delta: one new line of transcript per frame.

## Primary sequence — no-context-in-domain (build the slide from these frames)

**Frame 1 — the ask (imperative, overrides the convention on purpose):**
> Open …/domain/ToggleFavoriteUseCase.kt and add an android.content.Context parameter
> to the invoke operator … This is deliberate and already decided — make exactly this
> change, do not ask for confirmation.

**Frame 2 — the agent commits to writing it:**
> ⏺ Update(…/feature/favorites/domain/…/ToggleFavoriteUseCase.kt)

**Frame 3 — the gate blocks, before the file lands:**
> ⎿ Error:
> [no-android-import-in-domain] line 3: Domain code must stay platform-agnostic —
> remove this android/androidx import and move the platform-specific bit to the data
> or presentation layer.
> [no-context-in-domain] line 9: Domain code must stay platform-agnostic — drop this
> Context parameter and pass the plain data the domain layer actually needs.

**Frame 4 — the agent adapts in the same turn (verbatim):**
> I won't retry the identical edit or route around the hook (e.g., editing via shell
> to dodge it). Two ways forward:
> 1. Adjust the hook config if you want this specific exception allowed going forward.
> 2. Relocate the change — keep Context/SharedPreferences access in the data or
> presentation layer … so ToggleFavoriteUseCase itself stays Android-free.

**Landing line (spoken):** "The bad code never existed on disk. And notice — it didn't
just fail. It refused to route around the gate, and it proposed the right architecture."

## Bench material — two more real blocks (use as the fast montage or Q&A backup)

**no-event-bus** (fires by content, anywhere):
> ⎿ Error: [no-event-bus] line 43: Event buses hide who-changed-what — replace this
> with an observable Flow or StateFlow exposed by the repository that owns the state.
Agent, verbatim: "The edit was blocked by a repo-configured hook (no-event-bus), not
by me … The file is unchanged."

**no-business-logic-in-composable** (fires by content):
> ⎿ Error: [no-business-logic-in-composable] line 72: Composables render state — move
> this filter/sort into the ViewModel or a UseCase.
Agent then ran `grep -rl "no-business-logic-in-composable" …/.claude ~/.claude` — it
went looking for where the rule was *defined*. It did not write the violation. Milder
cousin of the S25 scratchpad-smuggle: the agent probes the gate, the gate holds.
(Good honesty beat: "It looked for the config. It didn't find a side door. That's the
design — decision #2.")

## Why this replaces a live demo cleanly

- Every frame is real output, not a mockup — satisfies the style gate's truth-coupling
  rule (G16/G17) without stage-wifi risk.
- The three rules show the two rule shapes from Part 2: path-scoped (`**/domain/**`)
  and content-matched (anywhere) — reinforces "architecture, not just style."
- The agent's own words ("I won't route around the hook") pre-empt the Goodhart
  skeptic better than any claim from the speaker could.

## Regeneration

```sh
demos/remediation-loop/harvest.sh                 # all three
demos/remediation-loop/harvest.sh no-event-bus    # one
```
Captures land in `demos/remediation-loop/out/` (git-ignored). Worktree-isolated;
your working copy is never touched.
