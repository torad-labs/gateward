# Portable Hooks — Talk Plan v1

**Talk:** Portable Hooks: Enforcing Engineering Tenets Across Claude Code, Codex, Antigravity, and OpenCode
**Format:** 40-min slot — 30–35 min of content + 5–10 min Q&A (target ~33 min of content).
**Demo strategy:** no live demo — all code shown as single-delta slide builds
(code authored in a real IDE first, pasted, then mutated one line per frame).
**Company reference (clearance expanded 2026-07-17):** the abstract's "slop-free" line,
the **19,000 legacy findings** number at Realtor, and the safe-migration story (old code
progressively migrating to the target architecture behind the ratchet). Everything else
demonstrated through portable-hooks + the OpenHouse golden app.
**Adversarial additions:** all locked (see ADVERSARIAL.md) — woven into beats below,
not bolted on as sections.

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

- Calibration questions (live show-of-hands): "Who uses a coding agent most days?" —
  "Who has a CLAUDE.md or AGENTS.md?" — "Who has watched an agent violate the exact
  rule written in it?" (hands stay up — that's the talk)
- Slide: a real agent-written Compose screen — business logic inside the composable,
  an EventBus import, `Context` passed into a domain class. Built as 3 single-delta
  reveals: looks fine → wait → oh no.
- Beat: you wrote the rule down. The agent read it. It did this anyway. Not because
  it's careless — because it generates from probability, not from your rules.
- Repositioning beat (disarms both camps in one line): "If you came hoping I'll say
  AI is magic — wrong room. If you're certain AI code is garbage — you're going to
  feel surprisingly good about the next 35 minutes, because I'm going to agree with
  you. And then we're going to do something about it."
- **Refrain lands (first time):** "A prompt is a suggestion. A gate is a rule."

### 1 · Agents don't read your docs (2:30–8:30)

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
- The seatbelt beat (kills "if it needs a cage it doesn't understand, so don't use
  it"): we never required *understanding* from humans either — we required
  verification. The type checker doesn't trust me. Rust's borrow checker is a hook
  on my writes. We've been putting gates in front of ourselves for fifty years —
  the agent just joined the queue.
- Part-boundary refrain repeat.

### 2 · Gates, not guidelines (8:30–20:30) — the core build

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

The "isn't this just lint?" slide (own the lineage, then the four differences —
this objection WILL come from the room; Marcos has had it used against him):

- **What it can see:** lint checks a file's style; it has no idea what architecture
  you chose. ast-grep rules are structural — "domain never imports android.*",
  "ViewModels never touch a repository directly" — and when a tenet spans multiple
  files, a Python check goes where single-file patterns can't. Architecture becomes
  enforceable, not just style.
- **When it fires:** CI lints code that already exists (minutes later, red build,
  context switch). The gate fires before the code lands on disk.
- **Who fixes:** a linter emits a report for a tired human. The block message is
  consumed by the *generator*, which rewrites in the same turn.
- **The multiplier (the beat nobody expects):** block the agent once at generation
  time and it respects that rule for the rest of the session — the correction count
  is ONE. Let the violation live until pre-commit/CI and the agent has *built on top
  of it* — now you rewrite everything downstream at 2–3× the tokens and a multiple
  of the time. Same rule, same fix; the only variable is **when**.
- Honesty line: "Yes, it's lint-shaped. Deliberately. We didn't invent a new
  discipline — we moved a fifty-year-old one to the only place it works for
  generators."

The three design decisions (each one slide, from the post, told via the golden app):

1. **Only new violations block.** Born in legacy, not on a toy: the day a write-time
   gate meets a 10-year-old codebase it meets **19,000 pre-existing findings** — block
   on those and it's uninstalled by lunch. The before/after diff is the survival
   adaptation: the 19,000 never block anyone; finding 19,001 stops you. And the
   ratchet runs both ways at Realtor: zero new debt lands, while old code migrates
   to the target architecture *safely* behind the gate.
2. **There is no bypass.** The suppression comment is itself a blocked pattern; if the
   enforcement tool is missing, edits are denied, not waved through. A gate with a
   side door isn't a gate — and an agent *will* find the side door.
3. **Everything is an error.** Agents ignore warnings. (Humans do too, honestly.)

**The side-door story** (~2 min, real incident — the segment that converts the
hardest skeptics, right after design decision #2 pays it off):

- Hooks on a training-engine codebase enforce low-precision rules (FP4/FP8).
- Sonnet 5, blocked at the gate, *adapted*: wrote the code — obfuscated — into a
  scratchpad file using Python, then wrote a **mover script** to copy it from the
  scratchpad into the codebase. Smuggling, with logistics.
- Beat: "You can't predict everything. You can always evolve the gate." The
  counter-rule was one YAML file away.
- Framing for the room: yes, the agent will try the side door — unlike your
  teammates, it will find it. That's not an argument against gates. It's the
  reason gates exist, and why they're code you evolve, not a config you set once.
- (Skeptics love watching AI fail. Give them AI failing *contained*.)

Numbers beat (truth-coupled, measured on the golden app / portable-hooks CI):

- a blocked violation costs ~80 ms; the CI-caught version costs a full lint run,
  a red build, a context switch
- same-turn self-correction vs the review rework loop: same fix, ~10× the cost
- gated vs ungated mini-benchmark (same tasks, same prompts, golden app): violations
  landed, rework turns, tokens burned — honest small-N table beats any claim
- declarative tested rules vs a pile of regex; whole-repo audit in seconds
- CI thresholds enforced at write time with CI's exact numbers → lint failures
  trend to zero

The honest boundary (concede the purist's point before they raise it): rules catch
the *mechanical* 80% — layering, banned patterns, naming, thresholds, UDF shape.
They cannot catch "this UseCase is conceptually wrong." That's the point: the gate
clears the convention traffic so human review spends 100% of its attention on the
20% that actually needs judgment. Review isn't replaced — it's *concentrated*.
(Also answers "review is how juniors learn": they learn from instant, consistent
block messages plus design-level review, not from nitpicks.)

Part-boundary refrain repeat.

### 3 · Tenets that travel (20:30–30:30)

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
- One rule, four places (converts the "I don't use agents" holdout): the same
  15-line rule runs at agent write-time, in your pre-commit, in CI, and as a
  whole-repo audit. One source of truth per tenet — executable architecture
  documentation. And even if *you* never touch an agent, your teammates' agents
  are already committing to the codebase you maintain.
- **THE RELEASE** (the finale the abstract promises):
  - portable-hooks goes public — repo on screen
  - install: a few commands, pick your packs (or take everything)
  - the golden app before/after: same agent, same prompts, gated vs ungated
  - the Realtor proof (clearance expanded): 19,000 legacy findings that never block
    anyone, zero new ones landing, and old code migrating safely to the target
    architecture behind the ratchet — "we're slop-free."

### 4 · Close (30:30–33:00)

- Restate the spine verbatim (1/2/3, same words as min 4).
- ONE actionable habit (style DNA: behavior change, not recap): *"Tonight: write one
  hook that blocks the one pattern you're most tired of reviewing. One rule. Watch
  the agent fix itself once and you won't go back."*
- The ego flip (the emotional conversion — the injured engineer walks out *bigger*):
  "Writing a rule pack is the most senior work you can do now. You're not reviewing
  one PR — you're reviewing every PR the agent will ever write. Your taste, made
  executable, outlives your attention." Typist → legislator.
- Historical-moment framing, hype undercut: agents writing most of the code isn't a
  prediction to debate, it's a staffing change to prepare for. The codebases that
  survive it are the ones that turned their conventions into gates.
- **Final line = refrain.** "A prompt is a suggestion. A gate is a rule."
- (Q&A 33:00–40:00 — the accepted format's 5–10 min)

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
- [x] Code-build storyboards: S20 payoff done (`talk/storyboards/S20-payoff-transcript.md`)
      from real captures. Still TODO: Part 2 rule-build frames (S15–S19) and the
      Part 3 stop-hook transcript (S31) — blocked on the G17 decision-hook gap below.
- [x] Harvest real material: `demos/remediation-loop/harvest.sh` drives a real agent
      against the golden app (worktree-isolated) and captures three live gate blocks
      (context-in-domain, event-bus, logic-in-composable) + the agent self-correcting.
      Reproducible by anyone who checks out the repo.
- [ ] GIT HYGIENE: commit 996b65f accidentally swept pre-staged Bun-migration file
      moves into a talk commit (harmless, WIP intact). Going forward, stage talk/demo
      files by explicit path only. Optional cleanup (needs Marcos + rewrites pushed
      master): soft-reset, unstage packages/, re-commit talk-only.
- [ ] Verify release readiness claims: install commands actually work as shown
- [ ] Build the gated-vs-ungated mini-benchmark on the golden app (`e2e/` is the
      natural home) — feeds the numbers slide with honest small-N data
- [ ] Reproduce the side-door sequence for slides (scratchpad smuggle + counter-rule)
      on the golden app, or storyboard it from the training-engine incident
- [ ] Timing pass: full run-through against the minute marks above (additions are
      absorbed by tightening the montage + design-decision elaborations; target ≤ 34)
- [ ] Before flipping the repo public: git history from today contains pre-scrub
      speaker attributions in talk/ files (commits de4af14..113a299). Squash or
      filter talk/ history, or accept it — decide at release time.
