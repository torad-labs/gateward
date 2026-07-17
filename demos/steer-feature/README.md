# Steer a feature — the decision-level gate

The `remediation-loop` demo gates what the agent **writes**. This one gates what
the agent **decides** — specifically, its decision to stop before the work is
done. It's the "don't stop until you're finished" nudge from the talk, made
mechanical instead of hopeful.

The pattern is **declare-then-earn**: a checked-in backlog is the memory, one
Bun CLI is the only writer, and a Stop hook reads the backlog when the agent
tries to end its turn. If any item is still open, the stop is blocked and the
model is handed the list of what's left. The agent may *declare* done; an open
ledger overrides the claim.

## The pieces (all Bun, zero dependencies)

- **`backlog.ts`** — the ledger CLI. `list`, `get <id>`, `next`, `add`,
  `set-status <id> <status>`, `note <id> "..."`, `selftest`. TOML-backed,
  atomic writes under an exclusive lock, notes appended as dated lines so a
  killed session is resumable from the file alone.
- **`stop-hook.ts`** — the Stop hook. Blocks a stop while any item is
  `todo`/`in_flight`; honors `stop_hook_active` so it can never loop.
- **`.tenets/backlog.toml`** — a seeded two-item backlog (F1 easy, F2 boring).
- **`settings.json`** — wires the Stop hook.

Status ladder: `todo → in_flight → done → verified`. "done" is the agent's
claim; "verified" is earned by proof. Open work is `todo`/`in_flight`.

## Try the CLI

```sh
cd demos/steer-feature
bun backlog.ts list
bun backlog.ts next
bun backlog.ts set-status F1 done      # prints what's still open
echo '{"cwd":"'"$PWD"'"}' | bun stop-hook.ts    # a block, because F2 is open
```

## Watch a real agent get steered

```sh
demos/steer-feature/harvest-steer.sh
```

It drives a real `claude` session (in a throwaway worktree) told to do only the
easy backlog item and stop. The Stop hook catches it with the boring item still
open and sends it back to work. Captures land in `out/` (git-ignored).

## Tests

```sh
bun test demos/steer-feature
```

## Where this goes

This is a self-contained reference implementation. It graduates into
`packages/core` (as a `stop.ts` event beside `pretooluse.ts`) once the core's
Python-to-Bun migration settles — the same path the fleet's version took, from
demo to product.
