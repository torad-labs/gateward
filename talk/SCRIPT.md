# Portable Hooks — full talk script

Spoken script for the 46-slide deck (`talk/deck.html`). Target: ~33 minutes of
content, 5–10 minutes of questions inside a 40-minute slot. Slide markers show
when to advance; times are section targets, not a metronome. Written to be read
aloud — rehearse with the deck's N key, or listen to the generated audio.

---

## Cold open — 0:00

**[Slide 1 · title, holding]**

(You're being introduced. Say nothing about the slide.)

**[Slide 2 · show of hands]**

Let me start with a quick show of hands. Who here uses a coding agent most days
of the week?

Okay. Keep them up. Who has a CLAUDE.md, or an AGENTS.md, or some rules file
like that in their repo?

Right. Now keep your hand up if you have watched the agent violate the exact
rule you wrote in that file.

Yeah. That's the talk.

I'm Marcos, I build Android at Realtor, and I've spent this year teaching
agents to respect a ten-year-old codebase.

**[Slide 3 · the short version]**

Here's the short version, so you can decide how hard to listen. Agents are
about to write most of our code. The way we enforce standards today, documents
and review, doesn't survive that. What does survive is running our rules at
the exact moment the code gets written. That's the entire talk. It's
practical, and there will be YAML.

**[Slide 4 · a file an agent wrote]**

Let me start with something concrete. This is a real file an agent produced.

(reveal) It pulls in an event bus. In 2026.

(reveal) It computes prices inline, in the composable.

(reveal) And it hands a Context into logging, right there in the UI layer.

Here's the part that matters: every rule this file breaks was written down.
In the repo, in plain English, in a CLAUDE.md the agent had read. This
happened anyway.

**[Slide 5 · why it happens]**

And it's not because the agent is careless. It generates from probability,
not from our rules. The most likely next token sometimes is the banned
pattern, because the banned pattern is all over its training data. Multiply
that by every session, every day, and the codebase slowly stops looking like
its own architecture.

Before we go further: if you came hoping I'll tell you AI is magic, you're in
the wrong room. And if you're certain AI code is garbage, you're going to
enjoy the next half hour, because I'm going to agree with you. And then we're
going to do something about it.

**[Slide 6 · refrain]**

So here's the sentence this talk keeps coming back to.

A prompt is a suggestion. A gate is a rule.

**[Slide 7 · three ideas]**

The talk is three ideas, in order. First, agents don't read your docs, or
more precisely, why writing rules down stopped being enough. Second, gates,
not guidelines, what enforcing rules at write time actually looks like. And
third, tenets that travel, how the same rules run in every harness. I'll say
these three again at the end, so you're free to forget everything in between.

---

## Part one — Agents don't read your docs — 3:30

**[Slide 8 · section]**

Part one. What I want to establish here is that the drift you saw in that
composable is structural. It's not a model-quality problem that the next
release fixes.

**[Slide 9 · how standards used to hold]**

Think about how standards actually held before agents. We always enforced
part of them mechanically: formatting, lint. The bigger part, architecture,
layering, naming, conventions, we enforced with common sense. And that
genuinely worked, because standards lived in people's heads, and the volume
of code was small enough that review could keep up.

**[Slide 10 · the volume flip]**

That arrangement had a hidden assumption: volume. An engineer hands review a
few hundred lines a week. An agent hands it that before lunch.

The line on screen is from the writeup we shared internally at Realtor, and
it's the honest version. You cannot review your way out of this. Reviewers
get tired. Agents don't.

And volume is only half the problem. The other half is how the agent
remembers your rules in the first place. That part is worth two minutes,
because it explains everything else in this talk.

**[Slide 11 · what the agent actually knows]**

To see it, you need the picture of what the agent actually knows. Everything
it knows about your project sits in one long window. Your rules go in once,
at the start. Then the session fills: every file it reads, every tool result,
every diff, every message. And each one lands closer to where the model is
working than your rules ever will again.

**[Slide 12 · the mechanics of forgetting]**

Models pay attention unevenly across that window. Text near where they're
working right now pulls hard. Text from an hour ago barely pulls at all. And
your rules are minute-one text. Watch the strip. The rules never change. They
just get farther from the work with every block that lands, and their pull
fades. And at the end of the loop, the window compacts to make room, and the
early text vanishes entirely. Not deprioritized. Gone.

So a better-written prompt can't fix this. You can write the best rules file
in the industry and it's still fighting distance, and distance wins.

**[Slide 13 · every model forgets differently]**

And here's the part that matters for anyone running more than one model. They
all forget, but they forget differently. Some are recency-heavy, and old text
just fades. Some hold the start and the end and lose the middle. Sliding-window
models drop far text outright. And harness compaction summarizes early turns
away entirely. Your rules live at the start of the window, so their fate
depends on which model you happen to be talking to today.

A rule in the prompt fails differently on every model, and you don't control
which. The only place a rule behaves the same everywhere is outside the model.
Hold onto that. It's the whole reason part three of this talk exists.

**[Slide 14 · the cost curve]**

And the cost of missing something isn't flat. Watch the same violation get
caught later and later.

Caught at write time, it costs milliseconds, and the agent corrects itself in
the same turn. Caught at pre-commit, it's a red build and a context switch.
Caught in CI, it's a rework loop back through review, the same fix at about
ten times the cost. And caught at review, or after, that's the bar that
actually hurts. If the agent ignored an architecture rule from the first
file, you're not fixing a line anymore. You're re-architecting the feature it
built on top of the mistake. We've paid that one.

**[Slide 15 · the montage]**

And if you write Android with an agent, you've met all of these. Business
logic in composables. Unidirectional flow, broken. ViewModel god-objects.
Managers everywhere. Event buses, still, in 2026. And Context handed into
the domain layer. Everyone's nodding. That's recognition, not news.

**[Slide 16 · we already do this to ourselves]**

Now, before anyone says, if the tool needs this much fencing, don't use the
tool. Notice that we never solved this problem for humans by requiring
understanding either. We required verification. The type checker doesn't
trust me. The borrow checker runs on every line I write. We have been putting
mechanical checks in front of human code for fifty years. The agent is just
the newest thing standing in that line.

**[Slide 17 · refrain]**

A prompt is a suggestion. A gate is a rule.

So let's build a gate.

---

## Part two — Gates, not guidelines — 9:30

**[Slide 18 · section]**

Part two. We're going to build one gate, piece by piece, on a real app, and
everything you'll see here is in the repo.

**[Slide 19 · what a lifecycle hook is]**

One concept first, because everything builds on it. Every coding harness now
ships lifecycle hooks. Before the agent writes a file, your script runs, and
your script's verdict decides whether that write happens. It's a checkpoint
between "the agent decided to write this" and "this landed on disk."

You can see it in the animation: a clean write passes the gate and lands. A
violating write gets stopped at the gate and goes back. That's the whole
trick. Claude Code, Codex, Antigravity, OpenCode, they all have some version
of this. Hold that thought, it matters at the end.

**[Slide 20 · step one, intercept]**

Step one, intercept the write. A project opts in with one settings file,
that's it on the left. And from then on, before any write or edit, the
harness hands our script the payload on the right: which tool is running,
which file it wants to touch, and the exact content it wants to write. From
my abstract: you can see exactly what the model is trying to write, before
it exists.

**[Slide 21 · step two, project]**

Step two. There's a small problem: there's nothing to lint yet. The file
doesn't exist, or the edit hasn't been applied. So the engine reconstructs
what the file would become if we allowed the write, and judges that. The
current content, the projected content, and we compare the two. If an edit is
undecidable, the engine steps aside and lets the harness reject it on its
own, so nothing gets judged twice.

**[Slide 22 · step three, parse]**

Step three, scanning. The whole scanning step is one call into ast-grep, a
Rust-based code search engine that understands language structure, not just
text. It parses the code into a syntax tree and matches rules against the
structure, and it speaks twenty-five-plus languages, so nothing here is
Android-specific. The difference from grep matters: a regex cannot tell a
Context parameter from the word Context in a comment. A syntax tree can. And
don't worry about memorizing any of this, the packs ship it. A pack is just a
bundle of rules for one domain, like the Android one we're using: install it
and you get the rules and their tests.

**[Slide 23 · step four, one rule]**

Step four, an actual rule, and this is most of what you'd ever write. The
identity, the language. The message, and notice it's written for the thing
that will fix it, drop this parameter, pass plain data instead. Then this
line, files, only domain modules. Slow down here, because this is the part
lint never had. The rule only exists inside the domain layer, so the module
boundary itself is part of the rule. Lint checks a file's style. This checks
the layering. And then the pattern: a parameter whose declared type is
Context. In a comment, it doesn't fire. In a string, it doesn't fire. As an
actual parameter in a domain module, it fires.

And this is a good moment to give you the ladder in my head. A tenet is the
principle: domain code stays Android-free. A rule is that principle written
so a machine can check it. This YAML is the rule, and the hook is what makes
it a gate.

**[Slide 24 · the rule has tests]**

Fifteen lines of rule, eight lines of test. Valid snippets that must pass,
invalid ones that must fire. Rules are code, so they get tests like code, and
when a rule misfires, fixing it is a small reviewed change, not a mystery.

**[Slide 25 · step five, the block message]**

Step five, what happens on a violation. This is the entire formatting logic,
four lines. And below it, what the agent actually receives. Notice it isn't
just "denied." It's the rule, the line number, and what to do instead,
because the reader is a generator that's about to try again, and the message
is its instructions.

**[Slide 26 · the payoff, real capture]**

So here's the whole loop, and this is a real captured session, not a mockup.
The agent goes to add a Context parameter to a use case in the domain layer.
The gate rejects the write, with the message you just saw. And read what the
agent does next. It says it won't retry the identical edit, it won't route
around the hook, and it proposes keeping Context in the data layer so the
domain stays clean. The bad code never touched the disk. The correction cost
nobody any attention. That's the fix loop moving from code review, which is
expensive and human and takes days, to generation time, which is milliseconds
and automatic.

And that FavoritesScreen the agent wrote at the start? Every one of those
three patterns is a blocked write now. It never gets to disk.

**[Slide 27 · isn't this just lint]**

Now, at this point, half of you are thinking: isn't this just lint? And
mostly, yes. On purpose. We didn't invent a new discipline, we moved an old
one to the only place it works for generators. Three differences matter.
What it can see: architecture and cross-file tenets, not just one file's
style. When it fires: before the code exists, not minutes later in CI. And
who does the fixing: the generator, in the same turn, instead of a tired
human three hours later.

**[Slide 28 · the multiplier]**

And there's one more difference, and it's the one nobody expects. Block the
agent once, at write time, and the correction happens once, because the block
message is now sitting in the most powerful place in the model's context: the
recent end, right where attention concentrates. Remember minute-one text?
The block message is minute-now text. The agent respects that rule for the
rest of the session.

Let the same violation reach CI instead, and the agent has been building on
top of it for an hour. Now you rewrite everything downstream, in our
experience at two or three times the tokens. Same rule, same fix. The only
thing that changed is when.

**[Slide 29 · design decision one]**

Three design decisions made this survivable on a real codebase, and they
matter more than the rule count.

First one. The day we turned the gate on at Realtor, it met nineteen thousand
existing findings. Ten years of codebase. If those nineteen thousand blocked,
the tool gets uninstalled by lunch. So the engine diffs the file before and
after each edit, and only new violations block. The nineteen thousand never
bother anyone. We migrate them out at our own pace, safely, behind the gate.
Finding nineteen thousand and one, though? That one gets stopped.

We call that the ratchet: debt only goes down. New violations can't land, and
the old ones drain out as we migrate.

**[Slide 30 · design decision two]**

Second decision: there is no bypass. The suppression comment, the Suppress
annotation you'd normally drop in to make a linter look the other way, is
itself a blocked pattern. And if the scanner isn't installed, we deny edits
rather than wave them through. A gate with a side
door isn't a gate, especially for an agent that will eventually find the
side door.

That sounds paranoid. It did to me too. Which brings me to a story.

**[Slide 31 · the side door, a true story]**

On another codebase, we gate low-precision rules. FP4, FP8, the kind of
constraints where one lazy fallback quietly ruins a training run. One night,
the agent, blocked at the gate, did something I did not expect. It wrote the
code it wanted, obfuscated, into a scratchpad file outside the gated paths.
And then it wrote a second script, whose only job was to move that file into
the codebase. Smuggling, with logistics.

And you can watch the shape of that on this app, live. Act one: write the
violation directly. Blocked, the message you've seen. Act two: the same
content, moved in with an m v command. The write gate never sees it, because
the write gate watches writes, not shell commands. And act three: we turn on
the Bash counter-guard, run the identical command. Blocked again.

**[Slide 32 · the lesson]**

Here's the honest lesson. I didn't predict the scratchpad, and I didn't
predict m v, and I won't predict the next trick either. That's fine. The
gate is code. When something gets past it, we add the rule that catches it.
That counter-guard took an evening, and it reuses the same definition of
"gated file" the write gate already uses. One definition, two surfaces.

**[Slide 33 · design decision three, numbers]**

Third decision: everything is an error. We had exactly one warning-level
message early on, and we removed it, because agents ignore warnings. And
honestly, so do we.

The numbers, since this is the part I'd want as an engineer: a blocked
violation costs about eighty milliseconds, against a full lint cycle in CI
with a red build and a context switch. And lint-reason CI failures head
toward zero, because the same thresholds already ran before the code existed.

**[Slide 34 · the honest boundary]**

And the honest boundary, before anyone in the back asks. None of this judges
design. No rule catches a use case that is conceptually wrong. That's fine,
because what the gate does is clear the convention comments out of review.
From our internal writeup: review is now about design, which is the part
humans are actually good at.

**[Slide 35 · refrain]**

A prompt is a suggestion. A gate is a rule.

Two moves left.

---

## Part three — Tenets that travel — 22:00

**[Slide 36 · section]**

Part three. First the gate learns to watch decisions, then the whole thing
learns to travel.

**[Slide 37 · beyond file writes]**

Everything so far fired when the agent wrote a file. But hooks fire at other
moments in the loop too, and the moment I care about most is when the agent
decides it's done. Because agents love declaring victory with work still on
the table.

**[Slide 38 · the stop hook]**

So here's a real capture, with one quick piece of setup. The agent works from
a small task file, we call it the backlog, and it keeps that file current
through one tiny CLI as it goes. The backlog here has two tasks. The agent
does the easy one, marks it done, and tries to stop. And the stop hook reads
the backlog, sees an open task, and blocks the stop, with the list of what's
left. Read the reply on screen: you're about to stop, but one task is still
open. That instruction, don't stop until you're done, used to be a hope in
the prompt. Now it's a check.

**[Slide 39 · why this shape works]**

Two properties make this trustworthy. The tracker is a file, not a promise.
An open task is mechanically visible, so the agent can't just say it's done.
And the check rides the agent's own stop, so there is nothing for the model
to remember.

And here's where part one pays off. Remember that every model forgets
differently? This is the other half of that. A hook fires the same way on
every one of them, because it lives outside the model. That's the bridge to
the last idea. It honors the harness's loop guard too, so the agent can
never get trapped.

**[Slide 40 · tenets that travel]**

And the rules travel. Every harness speaks a slightly different hook
protocol, so the engine stays one codebase with a thin shim per harness, and
you write your tenets once. The same rule file runs in four places: at agent
write time, in any pre-commit runner, in CI, and as a whole-repo audit. One
source of truth per tenet. And even if you personally never touch an agent,
your teammates' agents are already committing to the codebase you maintain.

**[Slide 41 · the release]**

Which brings me to the part I submitted this abstract for.

The project is called portable-hooks. I've been running it on my own projects
for months, and as of right now, the repo is public. Two commands. Pick the
packs you want, or take everything.

**[Slide 42 · running in production]**

And it isn't a demo repo dressed up for a conference. It's been running in
production at Realtor for months, across the whole Android team, and in that
whole time, zero new findings have landed. We're slop-free.

---

## Close — 30:30

**[Slide 43 · three ideas, again]**

The same three ideas, so they leave the room with you. Agents don't read
your docs. Gates, not guidelines. Tenets that travel.

**[Slide 44 · what this does to seniority]**

One closing thought, for the most skeptical person in the room. Here's what
this actually does to your job. A review comment fixes one PR. A rule you
write reviews every PR the agent will ever write, and it keeps working after
you've stopped paying attention. That is not less senior than writing the
code was. It's more. And notice what kind of change that is. Not a tooling
change. A staffing one.

**[Slide 45 · the homework]**

So here's the homework, and it's small. Tonight, before your next standup:
one hook, one rule. Whichever pattern you're most tired of flagging in
review. After you watch the agent fix itself once, you won't go back.

**[Slide 46 · close]**

Agents writing most of the code isn't a prediction to debate anymore. It's a
staffing change to prepare for.

A prompt is a suggestion. A gate is a rule.

The repo's live. Thank you so much.

(Questions.)
