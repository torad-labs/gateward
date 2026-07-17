---
name: talk-style-gate
description: Gate any talk artifact (talk/DECK.md, talk/storyboards/*, script drafts, PLAN.md) against the stage style DNA distilled from a studied corpus of elite technical conference talks — brain concept #1001 and the technical_stage voice. Use when asked to "run the style gate", "gate the deck", "review the deck against the style", "talk style review", "run the style skill on the deck", or before committing any deck/script change.
---

# Talk Style Gate

Adversarial style review for the Droidcon USA talk artifacts. Behave like the talk's
own write-time hooks: every finding is a BLOCK with an exact location, what's wrong,
and **what to do instead** — never a vague warning. Everything is an error; there are
no warning-level findings.

## Procedure

1. **Load the evidence base** (progressive disclosure — read what exists, skip what doesn't):
   - `talk/research/corpus/ANALYSIS.md` — quote-backed communication patterns
   - `talk/research/corpus/ANALYSIS.md` — quote-backed communication patterns
   - `talk/ADVERSARIAL.md` — the eight locked skeptic-proofing beats
   - `talk/PLAN.md` — the locked structure the artifact must implement
2. **Read the target artifact** (the file(s) the user pointed at; default `talk/DECK.md`).
3. **Run every gate rule below.** For each: PASS or BLOCK. A BLOCK must cite the
   location (slide/section), the rule, and a concrete rewrite suggestion.
4. **Report**: findings ordered most-severe first, then a per-section verdict table,
   then the single highest-leverage fix. If zero blocks: say so plainly, no padding.

## Gate rules

### Opening
- G1 · First 60 seconds contain shared pain or a live calibration question. NO bio,
  NO agenda slide, NO "about me / about this talk". (a conference speaker: "how many people are
  familiar with what RxJava is?")
- G2 · The calibration question does real work (filters/warns/sets stakes), not
  an icebreaker.

### Structure
- G3 · Exactly three spine parts, stated by ~minute 4, restated near-verbatim in the
  close. Verify the two statements actually match.
- G4 · Complexity ratchet: one foundation locked first; exactly ONE new element per
  step; no backtracking to re-explain; every build step is a complete presentable state.
- G5 · Zoom-ins are announced ("we're going deeper on X") — never silent scope jumps.
- G6 · Decision rules and recommendations land AFTER the motivating story/cost, never before.

### Code on slides
- G7 · Single-delta builds: each code slide mutates ONE thing from the previous frame.
- G8 · ≤ 15 LOC per code slide; ≤ 6 single-line bullets per slide, revealed individually.
- G9 · Concrete artifact BEFORE abstraction: real code / block message / transcript
  precedes every conceptual claim. Punchline sits on the LAST frame of a build chain.
- G10 · Narrate builds in first-person-plural with suspense beats (a conference speaker: "hooray,
  we found a new line") — the audience discovers with you, not from you.

### Language
- G11 · One coined refrain ("A prompt is a suggestion. A gate is a rule."), verbatim
  at each recurrence, ≥ 3 recurrences, final line of the talk.
- G12 · Educated-layperson register, never talked down to; jargon introduced with a
  one-sentence definition that then serves as the refrain-style shorthand.
- G13 · "We" for building, "I" only for testimony/war stories (the side-door incident
  is an "I" zone — announce it as one).
- G14 · Humor is dry and hype-puncturing; never punches at the audience; running
  gags allowed (speakers reuse jokes across years — one internal callback minimum).
- G15 · Banned words unless quoted ironically: revolutionary, game-changing,
  disruptive, magic, blazingly.

### Truth-coupling
- G16 · Every quantitative claim is paired with a real measurement source (golden-app
  benchmark, CI timing, the cleared Realtor numbers) — nothing unverifiable.
- G17 · Every capability claim maps to runnable code in this repo (packs/, packages/,
  apps/golden, e2e/). If the deck shows it, the repo must do it.

### Skeptic weave (from ADVERSARIAL.md — all eight are locked)
- G18 · Each objection beat survives in the artifact: wrong-room repositioning ·
  lint-delta (incl. cross-file/architecture + once-per-session multiplier) ·
  side-door story · born-in-legacy 19k ratchet · honest 80/20 boundary · seatbelt
  beat · one-rule-four-places · ego flip in the close.

### Close
- G19 · Ends on ONE actionable habit (time-boxed if possible; a conference speaker precedent:
  release-on-stage) — never a recap slide.
- G20 · Hype undercut on exit; exit open; humanizing coda allowed, victory lap not.

## Output format

```
BLOCKS (n)
1. [G<rule>] <slide/section> — <what's wrong>. Fix: <concrete rewrite>.
...
SECTION VERDICTS
<section>: PASS | n blocks
HIGHEST-LEVERAGE FIX
<the one change that clears the most blocks>
```
