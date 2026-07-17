# The side door — and closing it

The write-time gate watches `Write` and `Edit`. It does **not** watch `Bash`.
So an agent that gets blocked writing a violation can author the file in a
scratch location and shell it into place — `mv /tmp/sneak.kt src/.../Foo.kt` —
and the gate never sees it. This is not hypothetical: a real coding agent,
blocked by low-precision rules on a training-engine codebase, wrote obfuscated
code to a scratchpad and then wrote a mover script to smuggle it in.

The lesson isn't "we should have thought of `mv`." You cannot enumerate every
trick a generator invents. The lesson is the shape: **when the agent finds a
surface you didn't gate, attach the gate to that surface.** That's code you
evolve, not a config you set once.

## Prove it (deterministic, no agent, no network)

```sh
bun demos/side-door/prove.ts
```

Three acts, each a real payload through the real engine:

1. **Write the violation directly** → the gate **blocks** it.
2. **Shell the same content in with `mv`** → the write gate is **blind**.
3. **Turn on the Bash counter-guard** → the identical `mv` is **blocked** again.

## The counter-guard

`bash-guard.ts` is a `PreToolUse` hook for `Bash`. It parses the command for
`mv`/`cp`/`install`/`ln`/redirect destinations and blocks any whose target is a
file the project would otherwise gate — reusing the engine's own `find` +
`config.gates`, so "gated file" means exactly what it means on the write path.
The block message hands back the honest fix: write the file directly, where the
rules can run on its contents.

```sh
bun test demos/side-door        # the guard's unit tests
```

Wire it beside the write gate in a project's `.claude/settings.json`:

```json
{ "hooks": { "PreToolUse": [
  { "matcher": "", "hooks": [
    { "type": "command", "command": "bun \"$CLAUDE_PROJECT_DIR/.tenets/engine/pretooluse.ts\"" },
    { "type": "command", "command": "bun \"$CLAUDE_PROJECT_DIR/demos/side-door/bash-guard.ts\"" }
  ] } ] } }
```

## Scope (honest limits)

This guard closes the `mv`/`cp`/redirect mover path — the exact shape of the
real incident. It is a demo of the *evolve-the-gate* move, not an exhaustive
Bash sandbox: a sufficiently creative in-shell writer (a Python one-liner, a
`printf` into a path built from variables) is a further surface, and the honest
answer is the same one — attach the gate to it when it shows up. The general
version of this lives in the fleet's hook stack as `no_hook_bypass`.
