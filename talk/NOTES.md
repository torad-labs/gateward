# Droidcon USA 2026 — Talk Working Notes

Working file, started 2026-07-17. Budget: ~5 focused hours to produce the presentation plan.
Rule learned the hard way: **everything in this folder gets committed and pushed the moment it changes.**

## Thesis — the one thing to nail

Fix AI-generated code **at generation time**, not at the end.

- CLAUDE.md / AGENTS.md / config files are *suggestions*. An agent generates from
  probability, not from your rules. It will drift — not from carelessness, but by nature.
- If you only catch violations at pre-commit / pre-push / review, the cost is not
  "change a few lines." It can be **re-architect the whole feature**, because the agent
  ignored the rules from the first file it wrote.
- Hooks move the enforcement point to the moment of writing: the violation is blocked
  before it lands on disk, the agent is told exactly why, and it fixes it **in the same
  turn**. Milliseconds and zero human attention, instead of days and a rework loop.

## The three capabilities to demonstrate

1. **Don't write slop.**
2. **Write high-quality code** — CI lint thresholds (complexity, class length, param
   counts) enforced at write time, with the exact numbers CI uses.
3. **Respect the architecture and the norms of the codebase** — the things CLAUDE.md
   politely requests, made impossible to violate.

## Refrain candidates (coin one, repeat it — style DNA rule)

- "A prompt is a suggestion. A gate is a rule."
- "We moved code standards from documents the AI might read to a gate the AI cannot pass."
- "Fix it before it exists."
- "Reviewers get tired. Agents don't."

## Candidate three-part spine (v0 — react to this)

1. **A prompt is a suggestion** — why CLAUDE.md can't hold the line; drift is structural.
2. **A gate is a rule** — hooks + ast-grep: block at write time, agent self-corrects in-turn.
3. **Only new debt blocks** — how to deploy this on a real 10-year codebase without
   freezing it (before/after diff, no bypass, everything is an error).

## Source material A — the company post (CTO-praised, full text in `sources/company-post.md`)

Beats to lift:

- Problem framing: standards live in an engineer's head; in a prompt they're a suggestion.
  "You cannot review your way out of this. Reviewers get tired, agents don't."
- Hooks in one paragraph: a gate between "the AI decided to write this" and
  "this landed on disk." On block, the agent is told why and fixes it in the same breath.
- The build: post-edit file projection → ast-grep syntax tree → 35 rules
  (~15 lines of YAML each, individually tested) + CI thresholds at write time.
- **Three design decisions matter more than the rule count:**
  1. Only new violations block (19,000 legacy findings never block; #19,001 stops you).
  2. No bypass (suppression comment is itself a blocked pattern; tool missing → deny).
  3. Everything is an error (agents ignore warnings; humans do too).
- Savings: ~80 ms at write time vs a full CI run + red build + context switch;
  same-turn self-correction vs 10× rework loop through review; reviewers freed for
  design; 2,700 lines of Python regex → ~700 lines of declarative tested rules;
  whole-repo audit < 5 s.

## Source material B — this repo (portable-hooks)

- `packages/` — the engine (core + shims: portable across Claude Code / Codex harnesses)
- `packs/` — rule packs, incl. `android-architecture` (e.g. no-android-import-in-domain)
- `apps/golden` — OpenHouse golden Android app (public, demoable stand-in for the work codebase)
- `demos/`, `e2e/`
- `wiki/` — the ADA-pattern book + seam-by-seam worked example
- NOT here (desktop-only, never committed): the anti-slop skill. Recreate or recover later.

## Delivery style (recovered from brain — concept #1001, distilled 2026-07-13)

- Open on pain the room recognizes. Zero bio, zero agenda.
- State a three-part spine early; restate it near-verbatim to close.
- Lock one foundation, add exactly one element per step; every build step is a
  complete presentable state (single-delta slide builds).
- Concrete artifact before abstraction; punchline on the last frame.
- Coin one refrain and repeat it. Dry, hype-puncturing humor.
- "We" builds, "I" testifies. Every claim truth-coupled to runnable code or a real measurement.
- Close on ONE actionable habit / behavior change, not a recap. Undercut hype on exit.

## Decisions (answered 2026-07-17)

- **Abstract:** accepted + binding — see `sources/abstract.md`. Title: "Portable Hooks:
  Enforcing Engineering Tenets Across Claude Code, Codex, Antigravity, and OpenCode".
  The finale IS the open-source release of this repo.
- **Demo:** none live — code on slides as single-delta builds (storyboarded like a demo).
- **Company material:** open-source recreation only (portable-hooks + OpenHouse golden
  app), plus the abstract's one already-public line: "implemented at Realtor — slop-free."
- **5-hour deliverable:** locked plan + deck skeleton + code-build storyboards, all rough.
- Plan lives in `talk/PLAN.md`.
