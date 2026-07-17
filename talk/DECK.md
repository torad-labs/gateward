# Deck Skeleton — Portable Hooks (Droidcon USA 2026)

v1 skeleton. ~33 min content + 7 min Q&A. Slide numbers are logical slides;
`[BUILD ×n]` = single-delta frames within the slide (one mutation per frame,
every frame a complete state). `{move}` tags cite techniques from the studied
talk corpus (local research notes, git-ignored). Code slides: ≤15 LOC, real IDE
highlighting, authored in `apps/golden` first.

Refrain (verbatim, 4 placements): **"A prompt is a suggestion. A gate is a rule."**

---

## 0 · Cold open (0:00–2:30)

**S1 — Black slide. No title.** {move: show-of-hands, calibration-does-work}
Three escalating hands questions:
1. "Who uses a coding agent most days of the week?"
2. "Who has a CLAUDE.md or AGENTS.md in their repo?"
3. "Keep your hand up if you've watched the agent violate the exact rule you wrote in it."
(note: hands stay up on 3 — "yeah. that's the talk.")
Spoken one-clause intro only (name → role → what you built): "I'm Marcos — I build
Android at Realtor and I've spent this year teaching agents to respect a
10-year-old codebase."
NO bio slide, NO agenda slide.

**S2 — TL;DR.** {move: thesis-before-setup}
One line on screen: "Agents will write most of your code. Your docs won't survive
that. Gates will."
(note: contract beat: "This talk is practical. There will be YAML.")

**S3 [BUILD ×3] — The composable that rots.** {move: wrong-answer-first}
Real agent-written Compose screen from the golden app:
a) looks fine · b) +EventBus import ("EventBus. In 2026.") · c) +business logic
inline, `Context` into domain. Punchline on last frame.

**S4 — "You wrote the rule down."**
"The agent read it. It did this anyway. Not carelessness — it generates from
probability, not from your rules."

**S5 — The wrong room beat.** (spoken over S4, or minimal text slide)
"If you came hoping I'll say AI is magic — wrong room. If you're certain AI code
is garbage — you're going to feel surprisingly good about the next 35 minutes,
because I'm going to agree with you. And then we're going to do something about it."

**S6 — REFRAIN №1.** Full-bleed: "A prompt is a suggestion. A gate is a rule."

**S7 — The spine.** {move: numbered-spine}
1. Agents don't read your docs. 2. Gates, not guidelines. 3. Tenets that travel.
(note: "three ideas. I'll repeat them at the end so you can forget everything in
between.")

## 1 · Agents don't read your docs (2:30–8:30)

**S8 — What we always enforced vs what we trusted.**
Mechanical: formatting, lint. Common sense: architecture, layering, conventions.
That worked — standards lived in heads, and review could keep up.

**S9 — The volume flip.** {move: physically-felt-limitation}
Hundreds of lines a week → hundreds an hour. "You cannot review your way out of
this. Reviewers get tired. Agents don't."

**S10 [BUILD ×4] — The cost curve.** (the slide that justifies the talk)
Same violation caught at: write time (ms, agent self-corrects) → pre-commit
(red build, context switch) → CI (rework loop) → review/end (**re-architect the
feature**). Cost counter mutates upward per frame.

**S11 [BUILD ×6, fast] — The Android montage.** {move: recognition-laughs}
One per frame: logic in composables · UDF broken · ViewModel god-object ·
Manager sprawl · EventBus (gag callback: "again: 2026") · Context in domain.
(note: fast — 10s per frame, let the laughs do the work)

**S12 — The seatbelt beat.**
"We never required understanding from humans either — we required verification.
The type checker doesn't trust me. Rust's borrow checker is a hook on my writes.
Fifty years of gates in front of ourselves. The agent just joined the queue."

**S13 — REFRAIN №2.**

## 2 · Gates, not guidelines (8:30–20:30)

**S14 — What a lifecycle hook is.** (foundation lock — one diagram, one sentence)
"A checkpoint between 'the agent decided to write this' and 'this landed on disk.'
Your code runs first. It can say no — and say why." Four harness logos (title
callback: Claude Code, Codex, Antigravity, OpenCode). {move: announce-zoom-in}
(note: "we're going to build one, piece by piece, on a real app.")

**S15 [BUILD ×3] — Step 1: intercept the write.** Hook config + 12-line script stub.
**S16 [BUILD ×2] — Step 2: project the post-edit file.** What the file *would* become.
**S17 — Step 3: parse, don't grep.** ast-grep in one slide — "your architecture is
structural. Stop grepping for it." (note: don't-worry beat — "you don't need to
memorize this; the packs ship it.")
**S18 [BUILD ×5] — Step 4: one rule, line by line.** `no-context-in-domain` YAML,
~15 lines, with its own test case. {move: one-change-per-step}
**S19 [BUILD ×2] — Step 5: the block message is instructions.**
Not "denied" — what's wrong + what to use instead.
**S20 [BUILD ×4] — Step 6: the payoff transcript.** {move: wrong-answer-first,
first-person-plural-suspense}
Agent writes violation → gate blocks with instructions → agent rewrites → file
lands clean. "The bad code never existed on disk."
(note: narrate as we-discovery: "watch what it does with the block message...
there it goes.")

**S21 — "Isn't this just lint?"** (the objection, stated before the room can)
(note: announce the turn — "now, the question half of you have been asking")
Own the lineage: "Yes, it's lint-shaped. Deliberately." Then the differences:
what it can see (architecture, cross-file tenets — ast-grep, then Python when
rules outgrow patterns) · when it fires (before the code exists) · who fixes
(the generator, same turn).

**S22 [BUILD ×2] — The multiplier.** (the beat nobody expects)
Block once at generation time → the agent respects the rule for the rest of the
session. Correction count: one. Wait for CI → it built on top of the violation →
rewrite everything downstream at 2–3× the tokens. "Same rule, same fix. The only
variable is when."

**S23 — Design decision 1: only new violations block.** {move: born-in-legacy}
"The day our gate met the codebase, it met **19,000 pre-existing findings**. Block
on those and it's uninstalled by lunch. The 19,000 never block anyone. Finding
19,001 stops you." Ratchet runs both ways: zero new debt in, legacy migrating out
safely — at Realtor, in production.

**S24 — Design decision 2: there is no bypass.**
The suppression comment is itself a blocked pattern. Tool missing → edits denied.
"A gate with a side door isn't a gate — and the agent *will* find the side door."

**S25 [BUILD ×3] — The side-door story.** (announced "I" zone — war story)
{move: I-testifies}
Storyboard: `talk/storyboards/S25-side-door.md`; real proof: `demos/side-door/`.
War story: hooks enforce FP4/FP8 rules on training-engine code; Sonnet, blocked,
wrote obfuscated code to a scratchpad then a mover script to smuggle it in.
Then prove the shape on the golden app — `bun demos/side-door/prove.ts`, three
acts: Write → BLOCKED · same content via `mv` → the write gate is BLIND · Bash
counter-guard on → the identical `mv` BLOCKED. Deterministic, safe on stage.
The point: "I didn't predict `mv`, or the scratchpad. When the agent finds a
surface you didn't gate, you attach the gate to that surface — Act 3 was one hook
away, reusing the same 'gated file' definition as the write gate. A gate isn't a
wall you build once. It's code you evolve."
- (Skeptics love watching AI fail — a demo that admits its blind spot on stage,
  then closes it, is the one they believe.)

**S26 — Design decision 3: everything is an error.**
"We had exactly one warning-level message. We removed it. Agents ignore warnings.
Humans do too, honestly."

**S27 — Numbers.** {move: stakes-not-adjectives}
80 ms at write time vs a full lint run + red build + context switch · gated vs
ungated on the same tasks (mini-benchmark table: violations landed, rework turns,
tokens) · whole-repo audit in seconds.

**S28 — The honest boundary.** (concede the purist's point first)
Rules catch the mechanical 80%. They cannot catch "this UseCase is conceptually
wrong." That's the point: review stops spending attention on convention traffic
and spends all of it on judgment. "Review isn't replaced. It's concentrated."
(note: the intern/staff-engineer beat, adapted stage-people joke — "the agent is
the 300-IQ intern. The gate is the staff engineer who's seen things.")

**S29 — REFRAIN №3.**

## 3 · Tenets that travel (20:30–30:30)

**S30 — Files → decisions.** {move: announce-zoom-in}
"So far the gate watches what the agent writes. It can also watch what the agent
*decides*."

**S31 [BUILD ×4] — The stop hook.** (real, tested — `demos/steer-feature/`;
storyboard: `talk/storyboards/S31-stop-hook.md`)
Backlog is the memory (2 items) → agent does the easy half, declares done → Stop
hook reads the ledger, blocks the stop, names the open item → agent goes back to
work. Verified block output on the slide, not a mockup.

**S32 — Why this shape.** Declare-then-earn: the tracker is an *input* you can't lie
to. Substrate not instruction: the nudge rides the agent's own stop (a prompt line
decays at compaction; a hook fires every turn, every model). Loop-safe via
`stop_hook_active`. "'Don't stop until you're done' — a mechanical check, not a
hopeful prompt line. One discipline, two checkpoints: the file, and the session."

**S33 — Portability.** Four harnesses, four slightly different hook protocols, one
rule set. Architecture slide: engine + packs + thin shims. "Write your tenets once."

**S34 — One rule, four places.**
Agent write-time · your pre-commit · CI · whole-repo audit. One source of truth
per tenet — executable architecture documentation. "And even if you never touch an
agent: your teammates' agents are already committing to the codebase you maintain."

**S35 — THE RELEASE.** {move: release-on-stage}
Repo on screen. "This is portable-hooks. As of right now, it's public."

**S36 [BUILD ×2] — Install.** The few commands. Pick your packs — or take everything.

**S37 — Before/after on the golden app.** Same agent, same prompts, gated vs
ungated. (gag payoff: "No EventBus. It's still 2026.")

**S38 — The Realtor proof.**
19,000 legacy findings that never block anyone · zero new ones landing · old code
migrating safely behind the ratchet. "We're slop-free."

## 4 · Close (30:30–33:00)

**S39 — The spine, verbatim.** {move: verbatim-restate}
1. Agents don't read your docs. 2. Gates, not guidelines. 3. Tenets that travel.
("if you forget everything I said today — keep these three.")

**S40 — The ego flip.**
"Writing a rule pack is the most senior work you can do now. You're not reviewing
one PR — you're reviewing every PR the agent will ever write. Your taste, made
executable, outlives your attention." Typist → legislator.

**S41 — One habit.** {move: time-boxed-CTA}
"Tonight, before your next standup: one hook, one rule — the one pattern you're
most tired of flagging in review. Watch the agent fix itself once. You won't go back."

**S42 — The stakes, undercut.** {move: stakes-close, metaphor-reinvoked}
"Agents writing most of the code isn't a prediction to debate — it's a staffing
change to prepare for. The codebases that survive it are the ones that turned
their conventions into gates. Fifty years of gates in front of ourselves. The
agent just joined the queue."

**S43 — REFRAIN, final line.** Full-bleed + small repo QR.
"A prompt is a suggestion. A gate is a rule."
(note: understated exit: "the repo's live. thank you so much." — no victory lap)

---

## Production notes

- Slide count: 43 logical / ~70 frames with builds. Pacing-QA pass required:
  export one-frame-per-build PDF, flip, fix, repeat.
- All code slides authored in `apps/golden` in the IDE first, pasted with real
  highlighting, then mutated per frame.
- Storyboards done: S15–S19 (`talk/storyboards/S15-S19-gate-build.md`, verbatim
  repo code), S20 payoff (real captures), S25 side-door (`S25-side-door.md`, real
  `demos/side-door/` proof), S31 stop-hook (real captured block).
- G17 RESOLVED: the decision-level hook is built, tested, and real in
  `demos/steer-feature/` (Bun backlog CLI + Stop hook). Graduates to `packages/core`.
- S25 side-door: the write gate's Bash blind spot is real and now has a tested
  counter-guard (`demos/side-door/bash-guard.ts`); `prove.ts` runs the 3 acts.
- S27 table: blocked on the gated-vs-ungated mini-benchmark (e2e/).
- Q&A pocket material: live-failure-to-material move — if anything breaks on
  stage, it becomes an exhibit.
