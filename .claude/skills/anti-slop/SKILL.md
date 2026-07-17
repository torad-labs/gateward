---
name: anti-slop
description: Remove AI-shaped writing from any text artifact — AI rhythm, AI staccato, AI word choices, AI communication style. Rewrites until nothing reads as machine-generated. Use on deck copy, talk scripts, blog posts, READMEs, release notes, or any prose before it ships. Trigger: "run anti-slop", "de-slop this", "remove the AI writing", "this reads like AI", or before committing any user-facing prose. (Recreated 2026-07-17 from the lost desktop original — diff against it when recovered.)
---

# Anti-Slop

The job: make the text read like a specific person wrote it on purpose. Not "polish" —
removal. Every AI-shaped pattern is an error to eliminate, then the sentence gets
rewritten to carry the same meaning in a human register.

## Procedure

1. Read the full target. Identify the intended voice (for this repo's talk material:
   the `technical_stage` register — short declaratives, dry, concrete, spoken).
2. Scan against every tell below. Collect findings: location, tell category, the
   offending text.
3. Rewrite in place. Do not soften — replace. Preserve meaning, kill the shape.
4. Re-scan the rewritten text. Repeat until zero findings. Report what was removed
   by category with before/after for the worst offenders.

## The exemption (read first)

A rhetorical device used ONCE, deliberately, at a load-bearing moment is craft — a
coined refrain, one inversion, one drama beat. The same device appearing as ambient
texture is slop. Judge saturation, not existence. When in doubt: would a tired human
editor cut it? Cut it.

## Tells

### Rhythm & cadence
- Staccato fragment chains: "Short. Punchy. Wrong."
- One-line dramatic paragraphs: "And that changes everything."
- Every sentence the same length; every paragraph 2–3 sentences; metronome prose.
- Em-dash saturation — like this — everywhere — as the only joint in the sentence.
- "It's not X. It's Y." / "This isn't about X — it's about Y." (the inversion tic)
- Rule-of-three everywhere: "faster, cleaner, and more reliable."
- Anaphora spam: three consecutive sentences opening with the same word.

### Words & phrases (delete or replace on sight)
- delve, tapestry, landscape, journey, realm, robust, seamless, comprehensive,
  crucial, pivotal, vital, foster, harness, unlock, elevate, empower, supercharge,
  streamline, leverage (as a verb), utilize, cutting-edge, game-changing,
  revolutionary, transformative, blazingly
- "in today's fast-paced world", "at the end of the day", "the reality is",
  "let's dive in", "buckle up", "here's the kicker", "the best part?",
  "spoiler alert", "pro tip", "fun fact", "chef's kiss", "\*chef's kiss\*"
- Empty intensifiers: incredibly, truly, deeply, genuinely, absolutely (when they
  add emphasis and no information)
- Hedging stacks: "arguably", "in many ways", "to some extent", "it could be said"

### Rhetorical moves
- Question-as-transition: "So what does this mean?" "Why does this matter?"
- False suspense: "But here's where it gets interesting."
- Announcing the content: "In this section we'll explore..."
- Recapping what was just said: "In other words, ..." "To summarize, ..."
- "Think about it." / "Let that sink in."
- Both-sidesing every claim into mush; apologizing before an opinion.

### Structure
- Intro that restates the task; conclusion that recaps ("In conclusion", "Ultimately").
- Bullet lists where prose belongs; headers on two-paragraph documents.
- Perfectly parallel bullet triplets with bolded lead-ins on every item.
- Emoji in technical writing. Title Case Headers On Every Line.
- "However", "Moreover", "Furthermore", "Additionally" as paragraph glue — real
  writing connects ideas by content, not by transition adverbs.

### Spoken-word slop (scripts and speaker notes)
- "Now, here's the thing", "Let me tell you", "I want to talk to you about",
  "Let's unpack that", "makes sense?", over-signposting every transition.
- Fake enthusiasm: "I'm SO excited to share", "This is HUGE."
- Hype adjectives in place of stakes or numbers.

## Rewrite rules (what replaces the slop)

- Vary sentence length by content: long when tracing a chain, short when landing a point.
- Concrete nouns and named things beat abstractions: "the mover script" not "a workaround".
- Claims carry evidence or numbers, not adjectives: "80 ms" not "blazingly fast".
- Connect paragraphs by consequence, not by transition adverbs.
- Humor: dry, specific, aimed at the writer's own side.
- If a sentence survives with fewer words, it was carrying slop weight — take the
  shorter version.

## Output format

```
REMOVED (by category, with counts)
rhythm: n · words: n · rhetoric: n · structure: n · spoken: n
WORST OFFENDERS (≤5, before → after)
- "<before>" → "<after>"
VERDICT: clean | n findings remaining (and why they were kept, per the exemption)
```
