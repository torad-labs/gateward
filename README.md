# portable-hooks (codename)

Engineering tenets enforced at write time, portably across coding-agent
harnesses. When an agent tries to write code that breaks your architecture,
your conventions, or your taste, the write is denied before it lands on disk —
with a reason the model reads and corrects from in the same turn.

Rules are declarative ast-grep YAML, ~15 lines each, with their own tests.
Only new violations block: legacy findings never stop anyone, and finding
N+1 is impossible. There is no warning tier and there are no side doors.

## Read the book

The reference is a self-contained developer book: [`wiki/index.html`](wiki/index.html)
— the loop, the gate, the invariants (T1–T12), shims and dialects, the
escalation ladder, and a case history of this system's own construction bugs.
The worked example, [`wiki/example/`](wiki/example/index.html), walks one rule
from a review comment to impossible, ending with what breaks when a step is
skipped. Open either file in a browser; there is no build step.

## Try it in two minutes

```sh
# in this repo — the broken app is pre-wired for Claude Code
cd apps/broken
claude   # ask it to add a force-unwrap somewhere, watch the deny + self-correction

# or install into any project
node packages/cli/dist/index.js init -y --packs all
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js audit
```

## Repository map

| Path | What it is |
|---|---|
| `packages/core/` | The gate engine — stdlib Python: projection, only-new diff, verdicts, canonical audit |
| `packages/shims/` | Codex (`apply_patch` translator) and OpenCode (plugin) |
| `packages/cli/` | The installer — TypeScript, zero runtime dependencies |
| `packs/` | 4 rule packs, 19 rules, every rule tested, every pack standalone |
| `apps/golden/` | The ideal architecture — audits **0**, CI-pinned |
| `apps/broken/` | The same app done wrong — audits **52**, CI-pinned |
| `e2e/` | Payload replay through the real entrypoints (13 cases) |
| `wiki/` | The book |

## Status

Pre-release. Private until launch; the name is a codename. Kotlin/Android packs
ship first; ast-grep speaks 25+ languages, so nothing in the engine is
Android-specific.
