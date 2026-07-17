# Storyboard — S15–S19: the core gate build (single-delta frames)

Every code excerpt below is VERBATIM from this repo (post Bun migration) — the
audience is watching the released product, not slideware. One mutation per
frame; every frame is a complete, working state. Narration cues in quotes.

Foundation already locked by S14 (the diagram): "a checkpoint between 'the agent
decided to write this' and 'this landed on disk.'"

---

## S15 — Step 1: intercept the write [BUILD ×2]

**Frame a — a project opts in with a settings file** (`apps/golden/.claude/settings.json`, whole thing):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "", "hooks": [
        { "type": "command",
          "command": "bun \"$CLAUDE_PROJECT_DIR/.tenets/engine/pretooluse.ts\"",
          "timeout": 10 } ] }
    ]
  }
}
```
(note: golden app's real file points at the engine via a relative path; the
vendored form shown is what the CLI installs. Verify path before deck freeze.)

**Frame b — what the harness hands us** (the payload, 6 lines):

```json
{ "tool_name": "Edit",
  "tool_input": {
    "file_path": ".../domain/ToggleFavoriteUseCase.kt",
    "old_string": "suspend operator fun invoke(listingId: String)",
    "new_string": "suspend operator fun invoke(listingId: String, context: Context)" } }
```
"Before any write or edit, our code runs first — and it can say no."

## S16 — Step 2: project the post-edit file [BUILD ×2]

**Frame a — the problem:** "The violation doesn't exist yet. There's no file to
lint. We judge what the file *would become*."

**Frame b — the Projection** (`packages/core/src/projection.ts`, verbatim):

```ts
/** The before/after content of a decidable, gated tool call. */
export interface Projection {
  path: string;
  toolName: string;
  /** On-disk content before the call ("" for a new file). */
  current: string;
  /** Content the call would produce. */
  projected: string;
}
```
(spoken, from the module doc — this line is gold): "The gate judges the
*projected* content, never the raw edit instruction. When the outcome is
undecidable, the gate declines to judge — the harness rejects that edit on its
own, and we never double-judge."

## S17 — Step 3: parse, don't grep [1 slide]

**The whole step is one spawn** (`packages/core/src/scan.ts:51`, verbatim):

```ts
const result = exec(["scan", "--inline-rules", rules, "--json=compact", tmp]);
```

- ast-grep: a syntax-tree engine, 25+ languages. "Your architecture is
  structural. Stop grepping for it."
- Why it matters in one example: regex can't tell a *parameter of type
  `Context`* from the word Context in a comment. A syntax tree can.
- (don't-worry beat): "You will not memorize this. The packs ship it."

## S18 — Step 4: one rule, line by line [BUILD ×5]

`packs/android-architecture/rules/no-context-in-domain.yml` — verbatim, built
one hunk per frame:

**Frame a — identity:**
```yaml
id: no-context-in-domain
language: kotlin
severity: error
```

**Frame b — the message (written for the fixer, not a dashboard):**
```yaml
message: >-
  Domain code must stay platform-agnostic — drop this Context parameter and
  pass the plain data the domain layer actually needs.
```

**Frame c — the scope. THIS is the architecture part:**
```yaml
files:
  - '**/domain/**'
```
"Lint sees a file. This rule sees your *layering*. It fires in domain modules
and nowhere else — the module boundary is part of the rule."

**Frame d — the pattern (the syntax tree, not a regex):**
```yaml
rule:
  any:
    - kind: class_parameter
    - kind: parameter
  has:
    kind: user_type
    regex: '^Context$'
```
"A parameter whose declared type is `Context`. In a comment? Doesn't fire. In a
string? Doesn't fire. As an actual parameter type in a domain module? Blocked."

**Frame e — the rule has its own tests** (`rule-tests/no-context-in-domain-test.yml`, whole file):
```yaml
id: no-context-in-domain
valid:
  - |
    class FavoritesRepositoryImpl(
        private val dataSource: FavoritesDataSource,
    )
  - 'fun observeListing(listingId: String): Flow<Listing?>'
invalid:
  - 'class FavoritesStore(context: Context)'
  - 'fun refresh(context: Context) {}'
```
"Fifteen lines of rule, eight lines of test. Rules are code. Code has tests."

## S19 — Step 5: the block message is instructions [BUILD ×2]

**Frame a — the entire formatting logic** (`packages/core/src/events/pretooluse.ts`, verbatim):

```ts
function denyReason(matches: Match[]): string {
  return matches.map((match) => `[${match.ruleId}] line ${match.line}: ${match.message}`).join("\n");
}
```

**Frame b — what the agent actually receives** (real captured output, harvest run):

```
Error: [no-context-in-domain] line 9: Domain code must stay platform-agnostic —
drop this Context parameter and pass the plain data the domain layer actually needs.
```
"Not 'denied.' Not a rule number and a wall of docs. What's wrong, where, and
what to do instead — consumed by a writer that fixes it in the same turn."
(→ S20 payoff transcript takes it from here.)

---

## Bonus frames — feeds S23 (design decision 1: only new violations block)

`packages/core/src/diff.ts` is 36 lines total and the doc comment IS the slide:

**Frame a (verbatim):**
```ts
/**
 * Only-new-violations diff.
 *
 * A gate that blocked on *every* finding would make the first edit to any
 * legacy file impossible.
 */
```

**Frame b — the whole mechanism in three lines (verbatim, trimmed):**
```ts
const keyOf = (match: Match) => `${match.ruleId} ${match.text}`;
// a finding is new only when its projected count exceeds its current count
if (count > (baseline.get(key) ?? 0)) fresh.push(match);
```
"That count comparison is why 19,000 legacy findings never block anyone — and
why finding 19,001 stops you. The ratchet is nine characters of comparison."

## Deck-freeze checks

- [ ] Confirm the vendored engine path in the S15a settings frame matches what
      `portable-hooks init` actually writes at release.
- [ ] Re-run `bun run verify` the week of the talk; refresh any excerpt that drifted.
- [ ] Every frame ≤15 LOC (currently: max 12). Pacing-QA per-frame PDF pass.
