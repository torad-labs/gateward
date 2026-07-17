# Source: accepted title + abstract (binding — attendees were promised this)

**Portable Hooks: Enforcing Engineering Tenets Across Claude Code, Codex, Antigravity, and OpenCode**

In this talk, I'm going to talk about how I've been setting up my projects for a future where most of the code is written by agents. It's coming, and the sooner you prepare for it, the better.

For many years, we've enforced architecture, best practices, and formatting on our code, but only parts of it were ever mechanically enforced. The majority were conventions we could apply with common sense. Code review was easier too, because we weren't getting hundreds of lines of code a week to review.

Nowadays, every coding agent harness ships with some kind of lifecycle hook: a script that lets you run code before or after each operation the model does. So before any write or edit to a file in your codebase, you can intercept that command and inspect it. You can see exactly what the model is trying to write, and compare it against your best practices, your architecture, your conventions, and so on.

If you've used coding agents to write Android code, you've probably seen them putting business logic into composables, not respecting unidirectional flow and view model responsibilities, using managers, or creating patterns that don't fit your codebase, like event buses or Context inside the business logic. It's a mess.

All of these can be avoided with a lifecycle hook that identifies the bad practice, intercepts it before it happens, and tells the agent what to do instead. The bad code never even gets written into a file.

On top of that, some hooks can weigh in on the decisions the agent is making. You can nudge it when it makes a decision that goes against your tenets, when it decides to stop working, or when it violates one of your directives. For example: "don't stop until you're fully done, and verify that your acceptance criteria are actually implemented."

You can run a script that checks the backlog the model's been keeping track of and nudges it to keep going if it isn't done.

There's much, much more I'll show and talk through.

At the end, I'm going to show you how you can easily bring a whole set of these hooks into your app, with an open-source project I'm excited to finally release. I've been working on it for a few months now and using it on my own projects, and we've implemented it at Realtor, where we're happy to say we're slop-free in our codebase!

It installs hooks for any agentic coding system with just a few commands, and you get all the best practices: you select the ones you want, or select everything, and bring it into your codebase.

Come join me in this talk and learn how to prepare your codebase for modern agentic coding and workflows.

---

## Promise checklist extracted from the abstract (the talk MUST deliver each)

- [ ] Framing: a future where most code is agent-written; prepare now
- [ ] History beat: mechanical enforcement was partial; the rest was common sense + manageable review — both collapse under agent volume
- [ ] Lifecycle hooks explained: intercept before write/edit, inspect intended content, compare against practices/architecture/conventions
- [ ] Android pain named: business logic in composables, UDF/ViewModel violations, managers, event buses, Context in business logic
- [ ] Block-and-instruct: bad code never lands on disk; agent told what to do instead
- [ ] Decision-level hooks: tenet nudges, don't-stop-early ("verify acceptance criteria"), backlog-continuation script
- [ ] "Much more": the three design decisions (only-new-blocks, no-bypass, everything-is-error), CI thresholds at write time
- [ ] Finale: open-source RELEASE of gateward — few commands, any harness (Claude Code / Codex / Antigravity / OpenCode), pick your rule packs
- [ ] Realtor mention: exactly the abstract's line — implemented at Realtor, "slop-free" (no deeper internal detail)
