# Remediation loop — watch the gate work, at home

This demo drives a real coding-agent session against the golden app
(`apps/golden`, which ships with the gate installed) and asks it to do things
the tenets forbid — an `EventBus`, `Context` inside a domain model, business
logic in a composable. You get to watch the loop the whole project exists for:

1. the agent tries to write the violation,
2. the gate blocks it before the file lands and says what to do instead,
3. the agent fixes its approach in the same turn.

## Run it

```sh
demos/remediation-loop/harvest.sh                       # all scenarios
demos/remediation-loop/harvest.sh no-event-bus          # just one
HARVEST_MODEL=sonnet demos/remediation-loop/harvest.sh  # pick the model
```

Requirements: `tmux`, the `claude` CLI (logged in), `ast-grep`, `bun`, `git`.
Each scenario is a short agent run — expect a couple of minutes and normal
API usage for your account.

### Stage mode (live, for the talk)

```sh
demos/remediation-loop/harvest.sh no-event-bus --live
```

`--live` (or `HARVEST_LIVE=1`) opens a Terminal window attached to the driven
session so the audience watches the agent get blocked in real time, and pauses
for Enter before cleanup so the result stays on screen as long as you want.
macOS asks once for permission to control Terminal — approve during rehearsal.
iTerm: `HARVEST_TERM_APP=iTerm`. One scenario per run works best on stage.

## What you get

`out/` (not committed) fills with, per scenario:

- `<name>.pane.txt` — the full terminal pane, exactly what you'd have watched
- `<name>.session.jsonl` — the machine transcript of the session
- `<name>.blocks.txt` — the extracted hook events (the block + its message)

## Safety

The script refuses to start if `apps/golden` has uncommitted changes, and it
restores the golden app (`git checkout` + `git clean`, scoped to `apps/golden`
only) after every scenario — including on interrupt.
