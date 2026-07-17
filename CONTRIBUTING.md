# Contributing

This repo enforces its own rules with the same gate it ships, so most
conventions here are machine-checked rather than argued about in review.

## Setup

Requirements: [Bun](https://bun.com) >= 1.3 and [ast-grep](https://ast-grep.github.io)
(`bun add -g @ast-grep/cli`, or `brew install ast-grep`). There is no build
step anywhere — the CLI, the engine, the shims, and the scripts all run
straight from TypeScript source.

```sh
bun install
bun run verify
```

`bun run verify` runs every layer CI runs, in order: typecheck (both
packages), Biome format+lint, the three bun:test suites, the OpenCode plugin
smoke test, `ast-grep test` for every rule pack, the 15-case e2e payload
replay, and the three audit pins (golden=0, broken=52, repo self-audit=0).

## The test layers

| Layer | Command | What it proves |
|---|---|---|
| CLI unit + integration | `cd packages/cli && bun test` | commands, domain logic, harness adapters, architecture rules |
| Engine unit | `cd packages/core && bun test` | config resolution, projection, only-new diff, audit |
| Rule packs | `ast-grep test` in each `packs/*/` | every rule's valid/invalid cases + snapshots |
| End-to-end | `bun e2e/run.ts` | real payloads through the real entrypoints |
| Audit pins | in `verify` | golden stays 0, broken stays 52, this repo stays 0 |

## House rules (the machine-checked ones)

- This repo gates its own TypeScript: the root `.tenets/config.toml` enables
  the `bun-best-practices` pack, and agent writes that violate it are denied
  at write time. The repo self-audit is pinned at 0 in CI — if your change
  trips it, fix the code, not the pin.
- `packages/cli/src/architecture.test.ts` enforces layering (domain/ imports
  nothing from cli/, commands/, or harnesses/), exit-code and stdout
  ownership, and the frozen `node:` allowlist. Growing the allowlist requires
  a justification row in ARCHITECTURE.md's nativeness ledger.
- Only-new violations block. The broken app's audit is pinned at 52 — if a
  rule or the app changes that number, the change must be deliberate: update
  the pin in the same commit and say why.

## Adding things

- **A harness**: one adapter file implementing `HarnessAdapter` in
  `packages/cli/src/harnesses/`, plus a registry entry. See ARCHITECTURE.md.
- **A rule pack**: `packs/<id>/` with `pack.yml` (including `language:`),
  `sgconfig.yml`, `rules/*.yml`, `rule-tests/*-test.yml`, and committed
  `ast-grep test -U` snapshots. Rules must not rely on `files:` globs — the
  gate feeds ast-grep per-file via `--inline-rules`.
- **A rule**: add it to the pack's `pack.yml` rules list; default-off,
  opinionated rules ship with `default_enabled: false`.

## Pull requests

Branch from `master`, keep `bun run verify` green, and fill in the PR template.
The `checks` workflow (lint + engine on Linux and macOS + the Android apps
build) must pass; if a pin breaks, the failing step prints which number
moved.
