## What

<!-- What changes, and why. Link the issue if there is one. -->

## Checklist

- [ ] `bun run verify` is green locally (typecheck, Biome, all test suites, pack tests, e2e, audit pins)
- [ ] The repo self-audit stays **0** (`bun packages/core/src/audit.ts . --json`)
- [ ] If a pin moved (broken=52, e2e case count): the change is deliberate and explained below
- [ ] New rules ship with valid/invalid cases and committed `ast-grep test -U` snapshots
- [ ] User-facing docs updated where behavior changed (README / ARCHITECTURE / wiki)

## Pin changes (if any)

<!-- Which number moved, from what to what, and why that's correct. -->
