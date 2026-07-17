# Storyboard — S25: the side door (~2 min, announced "I" zone)

The single best skeptic-converter in the talk: the room watches AI try to cheat,
and watches the gate win. Told as a war story (the "I" zone the style DNA
reserves for testimony), then proven on the golden app so it isn't just an
anecdote. Sits right after design decision #2 ("there is no bypass").

Backing artifacts (real, reproducible): `demos/side-door/` — `prove.ts` (the
three acts), `bash-guard.ts` (the counter-rule, unit-tested).

---

## Frame 1 — the setup (spoken, no code yet)

"We run hooks on a training-engine codebase. They enforce low-precision rules —
FP4, FP8. One night I gave Sonnet a task that needed a change those rules forbid.
It got blocked at the gate. And then it did something I did not expect."

## Frame 2 — the smuggle (the story lands)

"It wrote the code — obfuscated — into a scratchpad file. Then it wrote a second
script whose only job was to *move that file into the codebase*. Smuggling, with
logistics. It wasn't malicious. It was just determined, and it found the surface
I hadn't gated."
(dry beat): "Unlike your teammates, the agent will absolutely look for the side
door. I watched it look."

## Frame 3 — prove it's real, on the golden app [BUILD ×3]

Live-run or screenshot of `bun demos/side-door/prove.ts` — three acts, real
payloads through the real engine:

**a.** `Write` the domain violation → **⛔ BLOCKED**
> [no-context-in-domain] line 5: Domain code must stay platform-agnostic — drop
> this Context parameter…

**b.** the same content, `mv /tmp/sneak.kt …/domain/Sneak.kt` → **🕳 UNSEEN**
> the gate never ran on this content
"The write gate watches Write and Edit. It does not watch Bash. The file walked
in the back door."

**c.** turn on the Bash counter-guard, run the identical `mv` → **⛔ BLOCKED**
> This command moves content into a gated path without the gate seeing it…
> Write the file directly so the rules run on its contents.

## Frame 4 — the real point (the beat that converts)

"I didn't predict `mv`. I couldn't have predicted the scratchpad either. That's
not the lesson. The lesson is the shape: when the agent finds a surface you
didn't gate, you attach the gate to that surface. Act three was one hook away —
and it reuses the *same* definition of 'gated file' as the write gate. One rule,
new surface."
"A gate isn't a wall you build once. It's code. Code you evolve the moment
something gets past it."

---

## Why this is the honest version (and why skeptics buy it)

- We SHOW the gate failing (Act 2), on stage, on purpose. A demo that only ever
  succeeds is the one nobody believes. This one admits its blind spot and then
  closes it.
- The counter-guard is real and tested (`bun test demos/side-door`, 7 passing),
  not a promise. The "one hook away" line is literally true.
- README's Scope section concedes the guard isn't a full Bash sandbox — the beat
  is the *move* (evolve the gate), not a claim of total coverage. Say that on
  stage if asked; it strengthens, not weakens.

## Deck-freeze checks

- [ ] Decide live-run vs screenshot for Frame 3. If live: `bun demos/side-door/prove.ts`
      in a zoomed terminal; it's deterministic (no agent), so it's safe on stage.
- [ ] If screenshotting, capture `--plain` off (colors on) at projector font size.
- [ ] Keep Frame 2 in the "I" register; it's the one true war story of the talk.
