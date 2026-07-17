# Portable Hooks — Talk Plan v1

**Talk:** Portable Hooks: Enforcing Engineering Tenets Across Claude Code, Codex, Antigravity, and OpenCode
**Format assumption:** ~40 min slot (modular — each section trims independently to fit 30).
**Demo strategy:** no live demo — all code shown as single-delta slide builds
(code authored in a real IDE first, pasted, then mutated one line per frame).
**Company reference:** only the abstract's own line ("implemented at Realtor — slop-free").
All numbers and examples demonstrated through portable-hooks + the OpenHouse golden app.

## The refrain

> **"A prompt is a suggestion. A gate is a rule."**

First landed at the end of the cold open, repeated at each part boundary,
final line of the close.

## The spine (stated at ~min 4, restated verbatim at close)

1. **Agents don't read your docs** — why CLAUDE.md can't hold the line.
2. **Gates, not guidelines** — enforce at write time, where the fix costs milliseconds.
3. **Tenets that travel** — decision-level hooks, portable across every harness.

---

## Section flow

### 0 · Cold open (0:00–2:30) — pain the room recognizes, zero bio, zero agenda

- Calibration questions (a conference speaker move): "Who uses a coding agent most days?" —
  "Who has a CLAUDE.md or AGENTS.md?" — "Who has watched an agent violate the exact
  rule written in it?" (hands stay up — that's the talk)
- Slide: a real agent-written Compose screen — business logic inside the composable,
  an EventBus import, `Context` passed into a domain class. Built as 3 single-delta
  reveals: looks fine → wait → oh no.
- Beat: you wrote the rule down. The agent read it. It did this anyway. Not because
  it's careless — because it generates from probability, not from your rules.
- **Refrain lands (first time):** "A prompt is a suggestion. A gate is a rule."

### 1 · Agents don't read your docs (2:30–9:00)

Foundation to lock: *drift is structural, not a model-quality bug.*

- History beat (from abstract): we always mechanically enforced *some* of it —
  formatting, lint. Architecture and conventions were common sense, and that worked,
  because humans carry standards in their heads and wrote ~hundreds of lines a week.
- The volume flip: agents ship hundreds of lines an hour. Review was the safety net;
  the net doesn't scale. "You cannot review your way out of this. Reviewers get tired.
  Agents don't."
- The cost curve (the slide that justifies the whole talk):
  - caught at write time → milliseconds, agent self-corrects in the same turn
  - caught at pre-commit/pre-push → red build, context switch, rework loop
  - caught at review/end → **re-architect the feature**, because the rules were
    ignored from the first file
  - Single-delta build: the same violation moving right along the timeline, cost
    counter mutating upward per frame.
- Android-specific montage (abstract promise): logic in composables, UDF broken,
  ViewModel God-objects, managers, event buses, Context in business logic. One slide
  each, fast, laughs of recognition.
- Part-boundary refrain repeat.

### 2 · Gates, not guidelines (9:00–22:00) — the core build

Foundation to lock first: *what a lifecycle hook is* (one diagram, one sentence):
a checkpoint between "the agent decided to write this" and "this landed on disk."
Your code runs first and can say no — and say *why*, and the agent fixes it in the
same breath. Every harness has these now (Claude Code, Codex, Antigravity, OpenCode —
title callback, sets up Part 3).

Then the single-delta build, one element per step, each step a complete working state:

1. Intercept the Write/Edit tool call (hook config + a dozen lines of script)
2. Project the post-edit file (what the file *would* become)
3. Parse it — ast-grep in one slide: syntax tree, not regex ("your architecture is
   structural; stop grepping for it")
4. Write one rule: `no-business-logic-in-composable` (or `no-context-in-domain`) —
   ~15 lines of YAML, built line by line, with its own test case
5. The block message: not "denied" but *instructions* — what's wrong, what to use
   instead
6. The payoff sequence: agent transcript as slides — agent writes violation → gate
   blocks with instructions → agent rewrites correctly → file lands clean.
   The bad code **never existed on disk**. (This replaces the live demo — storyboard
   it like a demo, frame by frame.)

The three design decisions (each one slide, from the post, told via the golden app):

1. **Only new violations block.** Before/after diff of rule matches. A 10-year-old
   codebase has thousands of findings — they never block; introducing one more stops
   you. Legacy stays workable; new debt is impossible.
2. **There is no bypass.** The suppression comment is itself a blocked pattern; if the
   enforcement tool is missing, edits are denied, not waved through. A gate with a
   side door isn't a gate — and an agent *will* find the side door.
3. **Everything is an error.** Agents ignore warnings. (Humans do too, honestly.)

Numbers beat (truth-coupled, measured on the golden app / portable-hooks CI):

- a blocked violation costs ~80 ms; the CI-caught version costs a full lint run,
  a red build, a context switch
- same-turn self-correction vs the review rework loop: same fix, ~10× the cost
- declarative tested rules vs a pile of regex; whole-repo audit in seconds
- CI thresholds enforced at write time with CI's exact numbers → lint failures
  trend to zero

Part-boundary refrain repeat.

### 3 · Tenets that travel (22:00–33:00)

Two moves: widen from *files* to *decisions*, then from *one harness* to *all of them*.

- **Decision-level hooks** (abstract promise): the gate isn't only for code.
  - Nudge on tenet-violating decisions
  - "You decided to stop — did you verify the acceptance criteria?" (stop-hook that
    checks the backlog and pushes the agent to continue; show the transcript beat
    where the agent goes back to work)
  - Directive enforcement: "don't stop until fully done" as a mechanical check, not
    a hopeful prompt line
- **Portability** (the title's promise): every harness ships hooks, every harness
  speaks a slightly different protocol. One rule set, thin shims per harness —
  write your tenets once, enforce them under Claude Code, Codex, Antigravity, and
  OpenCode. (Architecture slide of portable-hooks: engine + packs + shims.)
- **THE RELEASE** (the finale the abstract promises):
  - portable-hooks goes public — repo on screen
  - install: a few commands, pick your packs (or take everything)
  - the golden app before/after: same agent, same prompts, gated vs ungated
  - the one permitted company line: "we run this at Realtor — we're slop-free."

### 4 · Close (33:00–36:00)

- Restate the spine verbatim (1/2/3, same words as min 4).
- ONE actionable habit (style DNA: behavior change, not recap): *"Tonight: write one
  hook that blocks the one pattern you're most tired of reviewing. One rule. Watch
  the agent fix itself once and you won't go back."*
- Historical-moment framing, hype undercut: agents writing most of the code isn't a
  prediction to debate, it's a staffing change to prepare for. The codebases that
  survive it are the ones that turned their conventions into gates.
- **Final line = refrain.** "A prompt is a suggestion. A gate is a rule."
- (Q&A buffer 36:00–40:00)

---

## Abstract-promise coverage map

| Promise | Section |
|---|---|
| Future: most code agent-written, prepare now | 0, 1, 4 |
| History: partial mechanical enforcement, common sense + review | 1 |
| Hooks explained (intercept, inspect, compare) | 2 |
| Android violations named | 0, 1 |
| Block-and-instruct, bad code never lands | 2 |
| Decision hooks: tenets, don't-stop, backlog nudge | 3 |
| "Much more": 3 design decisions, CI-at-write-time | 2 |
| Release: few commands, any harness, pick packs | 3 |
| Realtor "slop-free" single line | 3 |

## Production checklist (rest of the 5 hours)

- [ ] Deck skeleton: section headers + slide-by-slide beats (`talk/DECK.md`)
- [ ] Code-build storyboards (the "demo on slides"): exact code states per frame for
      the Part 2 build and the Part 3 stop-hook transcript (`talk/storyboards/`)
- [ ] Harvest real material from this repo: a real pack rule, a real block message,
      golden-app before/after (`packs/`, `apps/golden`, `demos/`)
- [ ] Verify release readiness claims: install commands actually work as shown
- [ ] Timing pass: full run-through against the minute marks above
