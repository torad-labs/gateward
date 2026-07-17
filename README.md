# portable-hooks (codename)

[![checks](https://github.com/torad-labs/portable-hooks/actions/workflows/checks.yml/badge.svg)](https://github.com/torad-labs/portable-hooks/actions/workflows/checks.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![runtime](https://img.shields.io/badge/runtime-bun-black)](https://bun.com)

Engineering tenets enforced at write time, portably across coding-agent
harnesses. When an agent tries to write code that breaks your architecture,
your conventions, or your taste, the write is denied before it lands on disk —
with a reason the model reads and corrects from in the same turn.

Rules are declarative ast-grep YAML, ~15 lines each, with their own tests.
Only new violations block: legacy findings never stop anyone, and finding
N+1 is impossible. There is no warning tier and there are no side doors.

Everything here is TypeScript running directly on [Bun](https://bun.com) —
the CLI, the gate engine, the shims, the scripts. There is no build step
anywhere in this repository, and this repository gates its own writes with
the same engine it ships (`.tenets/config.toml` at the root; the self-audit
is pinned at **0** in CI).

## Read the book

The reference is a self-contained developer book: [`wiki/index.html`](wiki/index.html)
— the loop, the gate, the invariants (T1–T12), shims and dialects, the
escalation ladder, and a case history of this system's own construction bugs.
The worked example, [`wiki/example/`](wiki/example/index.html), walks one rule
from a review comment to impossible, ending with what breaks when a step is
skipped. Open either file in a browser; there is no build step.

## Try it in two minutes

Requirements: [Bun](https://bun.com) >= 1.3 and
[ast-grep](https://ast-grep.github.io) (`bun add -g @ast-grep/cli`, or
`brew install ast-grep`).

```sh
# in this repo — the broken app is pre-wired for Claude Code
cd apps/broken
claude   # ask it to add a force-unwrap somewhere, watch the deny + self-correction

# or install into any project
bun packages/cli/src/index.ts init -y --packs all
bun packages/cli/src/index.ts doctor
bun packages/cli/src/index.ts audit
```

## Repository map

| Path | What it is |
|---|---|
| `packages/core/` | The gate engine — zero-dependency TypeScript on Bun: projection, only-new diff, verdicts, canonical audit |
| `packages/shims/` | Codex (`apply_patch` translator) and OpenCode (plugin) |
| `packages/cli/` | The installer — layered TypeScript, one runtime dependency (valibot, for JSON boundary validation; [ARCHITECTURE.md](ARCHITECTURE.md)) |
| `packs/` | 5 rule packs, 28 rules, every rule tested, every pack standalone |
| `apps/golden/` | The ideal architecture — audits **0**, CI-pinned |
| `apps/broken/` | The same app done wrong — audits **52**, CI-pinned |
| `e2e/` | Payload replay through the real entrypoints (15 cases) |
| `wiki/` | The book |
| `scripts/verify.ts` | Every CI layer in one local command: `bun run verify` |

## Contributing

[ARCHITECTURE.md](ARCHITECTURE.md) explains the layering, the harness-adapter
seam, and the Bun-nativeness ledger; [CONTRIBUTING.md](CONTRIBUTING.md)
covers setup, the test layers, and how to add a rule, a pack, or a harness.
`bun run verify` runs everything CI runs.

## Status and roadmap

Pre-release; the name is a codename. Kotlin/Android packs shipped first, and
the `bun-best-practices` pack gates this repo's own TypeScript; ast-grep
speaks 25+ languages, so nothing in the engine is language-specific.

Deliberately not built yet: npm publishing and compiled single-binary
releases (both blocked on a packaging step that bundles packs + engine into
the artifact — see `packages/cli/src/paths.ts`), and autofix passthrough for
Codex's `apply_patch` (no protocol channel for it today; degrades to a deny
that says so).

Licensed under [Apache-2.0](LICENSE).
