# Architecture

gateward is three cooperating pieces, all TypeScript on Bun:

1. **The gate engine** (`packages/core/`) — evaluates every attempted write in a gated project and answers allow/deny. Vendored verbatim into target projects as `.tenets/engine/`; runs there with `bun`, no install step, no node_modules. **Zero dependencies, structurally**: a vendored copy has nothing to import from.
2. **The installer CLI** (`packages/cli/`) — vendors rule packs + engine into a project and wires them into detected harnesses. Runs from TypeScript source; there is no build step anywhere in this repository. Carries exactly one runtime dependency — [valibot](https://valibot.dev), used only in `boundaries.ts` to parse the JSON the CLI reads ("parse, don't validate"); everything past that edge is trusted, cast-free types.
3. **Rule packs** (`packs/`) — declarative ast-grep YAML, each pack self-contained with its own tests.

## CLI layout and dependency rules

```
packages/cli/src/
  index.ts        entry: dispatch. SOLE owner of the process exit code, and
                  (with cli/ui.ts) of stdout. Everything else returns data.
  paths.ts        shared kernel: repo-relative path resolution (import.meta.dir
                  three levels up = repo root; stays at src/ top level).
  types.ts        shared kernel: cross-layer types, incl. CommandOutcome.
  cli/            presentation: args.ts (hand-rolled flag parser + help),
                  ui.ts (tables, interactive prompts, tty), errors.ts
                  (CliError and the 0/1/2 exit-code contract).
  domain/         pure logic, no user I/O: packs.ts (pack.yml), vendor.ts
                  (copy/hash/write-if-changed), lock.ts (sha256 + lock.json),
                  tenetsConfig.ts (config.toml generate/parse).
  harnesses/      the extensibility seam: adapter.ts defines HarnessAdapter
                  {id, signals, wire(), check()}; claude.ts / codex.ts /
                  copilot.ts / opencode.ts implement it; index.ts is the
                  registry.
  commands/       init/doctor/audit/add/remove/update — orchestrate domain +
                  harnesses; return {lines, status}; never print, never exit.
```

Dependency direction: `commands → (domain | harnesses | cli) → kernel`. `domain/` imports nothing from `cli/`, `commands/`, or `harnesses/`.

**Adding a harness** is one adapter file implementing `HarnessAdapter` plus one registry entry in `harnesses/index.ts`. `init`, `doctor`, and detection pick it up with no other change.

## Two enforcement layers

The repo enforces its own rules with the same philosophy it sells, split by what each layer can see:

- **The write-time gate** (this repo's own `.tenets/config.toml` + the `bun-best-practices` pack) enforces *language-level* idioms — banned imports, banned shebangs — on every agent write, path-independent by design.
- **`architecture.test.ts`** enforces *path-aware* topology the gate cannot express: the layering rules above, exit-code/stdout ownership, and the frozen `node:` allowlist below. It parses every import in `src/` on every test run.

## Bun-nativeness ledger

Prime rule: **if a Bun-native API exists, we use it.** Adopted everywhere:

| Concern | API |
|---|---|
| File content I/O | `Bun.file().text()/.json()/.exists()`, `Bun.write()` ([docs](https://bun.com/docs/runtime/file-io): "the recommended way to work with files") |
| Process spawning | `Bun.spawnSync` ([docs](https://bun.com/docs/runtime/child-process): "better for building command-line tools"; array cmd = no shell injection) |
| Directory enumeration | `Bun.Glob` |
| Hashing | `Bun.CryptoHasher("sha256")`; tests cross-check via WebCrypto `crypto.subtle` |
| Env / argv / module dir | `Bun.env`, `Bun.argv`, `import.meta.dir` |
| Interactive input | raw-stdin escape-sequence decoder in `cli/ui.ts` (the multiselect needs raw-mode arrow keys, which line-oriented `prompt()` can't deliver; no `node:readline`) |
| Scripts + test fixtures | `Bun.$` (rm -rf, mkdir -p) |
| Arg parsing | hand-rolled `cli/args.ts` (house rule: narrow inputs get narrow, auditable parsers — same as pack.yml and config.toml) |
| JSON boundary validation (CLI only) | valibot schemas in `boundaries.ts` (kernel) — the CLI's single runtime dependency; the engine's boundaries stay hand-narrowed because a vendored engine cannot import anything |
| Test runner | `bun:test` with `expect()` |

The **irreducible remainder** — `node:` builtins with no Bun-native equivalent, running on Bun's own native implementations of those modules. Frozen by `architecture.test.ts`; growing the list requires a row here with a justification:

| Import | Where | Why there is no Bun-native way |
|---|---|---|
| `node:path` | anywhere | Bun has no path-manipulation API; this IS Bun's native impl (100% of Node's path tests pass) |
| `node:fs` (structural only) | vendor/lock/adapters | `mkdir`/`readdir`/`stat`/`chmod`/`exists-on-dirs` have no `Bun.*` equivalent — [Bun's File I/O docs](https://bun.com/docs/runtime/file-io) route exactly these to `node:fs` |
| `node:os` (`tmpdir`) | tests only | no Bun temp-dir API |
| `process.exitCode/cwd/platform/isTTY/execPath` | index/ui/paths | no `Bun.*` equivalents (`Bun.env`/`Bun.argv` cover env and argv; the rest have no alias) |

Deliberate non-adoptions, each backed by official guidance: `process.env` spread in child-env construction is fine (`Bun.env` is an alias of the same object); `Bun.$` is not used for CLI-internal spawns (array-arg `Bun.spawnSync` avoids shell interpolation of untrusted paths).

## The gate engine

`packages/core/` is zero-dependency TypeScript executed by Bun directly — in this repo *and* as vendored `.tenets/engine/` copies in target projects. Its imports are limited to relative modules, `Bun`/web globals, and the ledger remainder; nothing may require an installed package (vendored copies have no node_modules). Modules: `config` (find + parse `.tenets/config.toml`, language→extension gating), `projection` (current/projected content from a tool payload), `scan` (ast-grep `--inline-rules` via `Bun.spawnSync`, fail-closed when ast-grep is missing), `diff` (only-new violations), `verdict` (Claude-Code hook-contract JSON), `audit` (whole-project counts), `events/pretooluse` (the PreToolUse entrypoint).

Only new violations deny. Legacy findings never block anyone; `audit` counts them. There is no warning tier and there are no side doors.

## Adding a rule pack

`packs/<id>/` needs `pack.yml` (id, `language`, title, rules list with tiers), `sgconfig.yml` (`ruleDirs`, `testConfigs`), `rules/*.yml`, `rule-tests/*-test.yml`, and committed `ast-grep test -U` snapshots. The CLI discovers packs dynamically; `config.toml`'s `[core] languages` derives from each selected pack's `language`. Rules must not rely on `files:` globs — the engine feeds ast-grep per-file via `--inline-rules`.
