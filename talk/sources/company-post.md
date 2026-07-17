# Source: internal company post (CTO-praised) — verbatim

> Context: posted internally in the "how are teams using AI" thread; praised by the CTO
> as one of the finest posts he'd seen. Large parts of this feed the Droidcon talk.

---

**How the Android team gets AI-generated code to follow our architecture, and what it saves us**

Sharing this for the "how are teams using AI" thread. It's about the least glamorous part of AI coding: not generating code, but stopping the generated code from slowly wrecking your codebase.

**The problem**

When an engineer writes code, our standards live in their head. When Claude writes code, the standards live in a prompt, and a prompt is a suggestion. An AI agent will happily use a banned pattern, put business logic in the wrong layer, or name things against convention, not because it's careless but because it generates from probability, not from our rules. Multiply that by every session, every day, and you get drift: a codebase that gradually stops looking like its own architecture. You cannot review your way out of this. Reviewers get tired, agents don't.

**What hooks are, in one paragraph**

Claude Code has checkpoints called hooks. Before the AI writes a single file, our code runs first and can say no. Think of it as a gate between "the AI decided to write this" and "this landed on disk". If the gate says no, the AI gets told exactly why and what to do instead, and it fixes the code in the same breath, before a human ever sees it.

**What we built**

Every time Claude edits a Kotlin file, we reconstruct what the file would look like after the edit, parse it into a syntax tree with a tool called ast-grep (a Rust-based code search engine that understands language structure, not just text), and run 35 rules against it. Rules like: no !! force-unwraps, no business logic in ViewModels, no EventBus, test names must follow Given/When/Then, UseCases must expose operator fun invoke(). Each rule is about 15 lines of readable YAML with its own test cases. On top of that we run our CI lint thresholds (method complexity, class length, parameter counts) at write time, using the exact numbers CI uses.

**Three design decisions matter more than the rule count:**

1. Only new violations block. We compare before and after each edit. The ~19,000 findings that already exist in our 10-year-old codebase never block anyone. Introduce number 19,001 and you're stopped. Legacy code stays workable, new debt is impossible.
2. There is no bypass. The suppression comment ast-grep normally honors is itself a blocked pattern in our setup, and if the enforcement tool isn't installed, Kotlin edits are denied rather than waved through. A gate with a side door isn't a gate, especially for an agent that will find the side door eventually.
3. Everything is an error. We had exactly one warning-level message early on and removed it. Agents ignore warnings. Humans do too, honestly.

**Where the savings are**

- CI money. A violation caught at write time costs ~80 milliseconds. The same violation caught by CI costs a full detekt run, a red build, a context switch, and a re-run. We now enforce the same thresholds before the code exists, so CI failures for lint reasons trend toward zero, and that opens the door to running CI lint less often or on fewer modules.
- AI tokens. When the AI produces a violation, the block message tells it exactly what's wrong and what to use instead. It corrects in the same turn. Without the gate, that bad pattern survives until review, then a human writes a comment, then the AI (or a person) does a rework loop. Same fix, ten times the cost.
- Review time. Reviewers stopped spending attention on "this belongs in a UseCase" comments. The gate already had that conversation. Review is now about design, which is the part humans are actually good at.
- Maintenance. Our previous attempt at this was ~2,700 lines of Python regex trying to parse Kotlin with string matching. It was slow to change, and three of its checks were broken in ways its own tests couldn't see. The replacement is ~700 lines of declarative rules, each independently tested. Whole-repo audit: under 5 seconds.

**What's reusable if your team wants this**

ast-grep supports 25+ languages, so none of this is Android-specific. The ingredients: a hook that intercepts file writes, a projection of the post-edit file, a before/after diff of rule matches, and rules written against the syntax tree instead of regex. We also built a /android-hook command in Claude Code that walks anyone through writing a new rule with tests in a few minutes, so the rule set grows with the team instead of with one maintainer. PRs with everything: #14582 (the system) and #14585 (removing the bypasses). Happy to walk any team through it.

The one-line summary for the cost thread: we moved code standards from documents the AI might read to a gate the AI cannot pass, and the fix loop moved from code review (expensive, human, days) to generation time (milliseconds, automatic, free).
