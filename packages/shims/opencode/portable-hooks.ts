/**
 * OpenCode plugin: gate write/edit tool calls through the portable-hooks core
 * engine — the same PreToolUse judgment Claude Code's hook and the Codex
 * shim invoke, applied via OpenCode's own extension point.
 *
 * Documented shape reused (harness-hooks-matrix research, opencode.ai/docs/
 * plugins.md + plugin/src/index.ts): a plugin module exports an async
 * factory that receives OpenCode's context and returns a hooks object.
 * `tool.execute.before(input, output)` runs before a tool executes; `input`
 * names the tool being called, `output.args` holds its arguments and can be
 * mutated in place. Blocking is done by throwing an Error (its message is
 * the deny reason); the codemod tier is done by mutating `output.args`
 * directly. OpenCode's `permission.ask` hook is documented but confirmed
 * broken in practice (issues #7006/#28066, fix PR #19453 unmerged) and is
 * deliberately not used here.
 *
 * Arg-name honesty: `filePath`/`content` for the write tool are the names
 * this product's spec pins directly. The edit tool's `oldString`/`newString`
 * are inferred by naming-convention consistency with `filePath` (camelCase
 * mirror of Claude Code's `old_string`/`new_string`) and the research file's
 * general description of the hook shape — they are not independently
 * confirmed against a live OpenCode install. Same honesty the harness
 * research applies to Antigravity's unpinned schema: ship what is verified,
 * flag what still needs pinning against a real install.
 *
 * TypeScript ESM, run natively: OpenCode's plugin runtime IS Bun, so this
 * plugin needs no build step, no CommonJS, and no interpreter lookup — the
 * engine subprocess is spawned via `process.execPath` (the running Bun
 * binary itself), which removes the old "python3 not installed" failure
 * mode entirely.
 *
 * Zero-dependency and fail-closed: throws, does not silently allow, when the
 * gate engine is missing/unresponsive while the target project has a
 * `.tenets/` (nothing to enforce when a project never opted in, so that case
 * silently allows instead). Each core invocation is synchronous
 * (`Bun.spawnSync`) with a 10-second timeout.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const DEV_LAYOUT_PRETOOLUSE = path.join(import.meta.dir, "..", "..", "core", "src", "events", "pretooluse.ts");
const SUBPROCESS_TIMEOUT_MS = 10_000;

/**
 * Locate the gate engine for the layout this plugin is actually running in.
 * Vendored install first: the CLI copies this plugin into
 * `<project>/.opencode/plugins/` and the engine into `<project>/.tenets/engine/`,
 * so walk up from the working directory looking for that engine. Fall back to
 * the monorepo dev layout (this file under packages/shims/opencode/). A
 * module-dir-only resolution bricked every vendored install: the relative
 * hop landed on a nonexistent path and all writes failed closed.
 */
function resolveEnginePretooluse(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const vendored = path.join(dir, ".tenets", "engine", "events", "pretooluse.ts");
    if (fs.existsSync(vendored)) return vendored;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fs.existsSync(DEV_LAYOUT_PRETOOLUSE) ? DEV_LAYOUT_PRETOOLUSE : null;
}

const WRITE_TOOLS = new Set(["write"]);
const EDIT_TOOLS = new Set(["edit"]);

/** True when the tool is one this gate is responsible for (a write or edit),
 * regardless of whether its arguments map cleanly. Used to tell "not our
 * tool — safe to allow" apart from "our tool, but we couldn't read its args
 * — must fail closed". */
function isWriteOrEditTool(toolName: unknown): boolean {
  return typeof toolName === "string" && (WRITE_TOOLS.has(toolName) || EDIT_TOOLS.has(toolName));
}

interface ToolArgs {
  filePath?: unknown;
  content?: unknown;
  oldString?: unknown;
  newString?: unknown;
}

interface MappedTool {
  name: string;
  input: Record<string, string>;
}

/** Map an OpenCode tool call's args to a Claude-shaped {name, input} pair,
 * or null when this tool/arg shape is not one this gate covers. */
function claudeToolInputFor(toolName: unknown, args: ToolArgs): MappedTool | null {
  if (typeof toolName === "string" && WRITE_TOOLS.has(toolName)) {
    if (typeof args.filePath !== "string" || typeof args.content !== "string") return null;
    return { name: "Write", input: { file_path: args.filePath, content: args.content } };
  }
  if (typeof toolName === "string" && EDIT_TOOLS.has(toolName)) {
    if (typeof args.filePath !== "string" || typeof args.oldString !== "string") return null;
    return {
      name: "Edit",
      input: {
        file_path: args.filePath,
        old_string: args.oldString,
        new_string: typeof args.newString === "string" ? args.newString : "",
      },
    };
  }
  return null;
}

/** Walk up from startDir looking for a .tenets/config.toml, mirroring
 * config.find()'s own upward search. */
function hasTenets(startDir: string): boolean {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".tenets", "config.toml"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Fail closed (throw, with remedy) when this project gates at all;
 * otherwise there is nothing installed here to enforce, so allow silently. */
function failClosedOrAllow(cwd: string, detail: string): undefined {
  if (hasTenets(cwd)) {
    throw new Error(`[portable-hooks] ${detail} Refusing to allow an unchecked edit.`);
  }
}

interface PluginContext {
  directory?: string;
}

interface ToolExecuteInput {
  tool?: string;
}

interface ToolExecuteOutput {
  args?: ToolArgs & Record<string, unknown>;
}

interface EngineVerdict {
  hookSpecificOutput?: Record<string, unknown>;
}

/** Spawns the gate engine with the given payload and returns its parsed
 * verdict, or undefined for a silent allow — either a clean write (empty
 * stdout) or, via failClosedOrAllow, a project with nothing to enforce.
 * Every failure path (spawn error, non-zero/signal exit, unparseable
 * stdout) fails closed instead. */
function runEngine(engine: string, payload: string, cwd: string): EngineVerdict | undefined {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync({
      cmd: [process.execPath, engine],
      stdin: new TextEncoder().encode(payload),
      timeout: SUBPROCESS_TIMEOUT_MS,
    });
  } catch (err) {
    failClosedOrAllow(
      cwd,
      `the gate engine did not respond (${(err as Error).message}). Check that ${engine} runs under bun, then retry.`,
    );
    return;
  }

  if (!result.success) {
    const why = result.signalCode === null ? `exited ${result.exitCode}` : `exited via signal ${result.signalCode}`;
    failClosedOrAllow(
      cwd,
      `the gate engine did not respond (${why}). Check that ${engine} runs under bun, then retry.`,
    );
    return;
  }

  const out = (result.stdout?.toString() ?? "").trim();
  if (!out) return; // silent allow: clean write

  try {
    return JSON.parse(out) as EngineVerdict;
  } catch (err) {
    failClosedOrAllow(cwd, `the gate engine printed unparseable output (${(err as Error).message}).`);
  }
}

/** Applies one engine verdict to the OpenCode tool call: throws on deny, or
 * mutates `output.args` in place with the engine's rewritten content/
 * new_string on an autofix allow. No-op on a plain allow with no rewrite. */
function applyVerdict(verdict: EngineVerdict, output: ToolExecuteOutput): void {
  const hookOutput = verdict?.hookSpecificOutput ?? {};
  if (hookOutput.permissionDecision === "deny") {
    throw new Error(
      typeof hookOutput.permissionDecisionReason === "string"
        ? hookOutput.permissionDecisionReason
        : "portable-hooks denied this edit",
    );
  }
  if (hookOutput.permissionDecision === "allow" && hookOutput.updatedInput && output.args) {
    const updated = hookOutput.updatedInput as { content?: unknown; new_string?: unknown };
    if (typeof updated.content === "string") output.args.content = updated.content;
    if (typeof updated.new_string === "string") output.args.newString = updated.new_string;
  }
}

// Not declared async: every step here (resolveEnginePretooluse, hasTenets,
// Bun.spawnSync) is deliberately synchronous (see the module doc), and both
// call sites (OpenCode's loader, this package's smoke-test.ts) already
// `await` the result, which resolves a plain return value immediately.
function PortableHooksPlugin(ctx?: PluginContext) {
  const context = ctx ?? {};
  return {
    "tool.execute.before": (input: ToolExecuteInput, output: ToolExecuteOutput) => {
      const cwd = context.directory || process.cwd();
      const mapped = claudeToolInputFor(input?.tool, output?.args ?? {});
      if (mapped === null) {
        // A write/edit tool whose args we couldn't map is NOT a safe allow
        // when the project gates: our OpenCode arg-name assumptions
        // (filePath + content/oldString) are unconfirmed against every
        // version, and silently allowing an edit we failed to read would be
        // fail-open. A tool that isn't a write/edit at all is genuinely not
        // ours — allow.
        if (isWriteOrEditTool(input?.tool)) {
          failClosedOrAllow(
            cwd,
            "an OpenCode write/edit arrived with arguments this gate could not map (expected filePath plus " +
              "content or oldString). The gate cannot judge it, and refusing beats waving an unread edit through.",
          );
        }
        return;
      }
      const engine = resolveEnginePretooluse(cwd);
      if (engine === null) {
        failClosedOrAllow(
          cwd,
          "the gate engine was not found — no .tenets/engine/ above the working " +
            "directory and no dev layout. Re-run `portable-hooks init`, then retry.",
        );
        return;
      }

      const payload = JSON.stringify({ tool_name: mapped.name, tool_input: mapped.input });
      const verdict = runEngine(engine, payload, cwd);
      if (verdict === undefined) return; // silent allow: clean write, or failClosedOrAllow chose to allow
      applyVerdict(verdict, output);
    },
  };
}

// biome-ignore lint/style/noDefaultExport: OpenCode's plugin loader imports the default export
export default PortableHooksPlugin;
