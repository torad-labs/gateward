#!/usr/bin/env node
"use strict";

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
 * CommonJS, not ESM: this repo's existing package.json files declare no
 * `"type": "module"` anywhere, so plain `.js` is CommonJS by default here —
 * matching that convention needs no new package.json. It is also the more
 * portable choice for a shim meant to be copied standalone into a consuming
 * project's `.opencode/plugin/` directory: `require()` needs no companion
 * config to work, where `export` syntax in a bare `.js` file would silently
 * depend on one. Node's ESM loader still resolves `PortableHooksPlugin` as a
 * named import from a module consumer via its standard CommonJS interop.
 *
 * Zero-dependency: only Node's `node:*` built-ins are used. Fails closed —
 * throws, does not silently allow — when python3 or the gate engine itself
 * is missing/unresponsive while the target project has a `.tenets/`
 * (nothing to enforce when a project never opted in, so that case silently
 * allows instead). Each core invocation is synchronous
 * (`child_process.spawnSync`) with a 10-second timeout.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEV_LAYOUT_PRETOOLUSE = path.join(__dirname, "..", "..", "core", "src", "events", "pretooluse.py");
const SUBPROCESS_TIMEOUT_MS = 10_000;

/**
 * Locate the gate engine for the layout this plugin is actually running in.
 * Vendored install first: the CLI copies this plugin into
 * `<project>/.opencode/plugins/` and the engine into `<project>/.tenets/engine/`,
 * so walk up from the working directory looking for that engine. Fall back to
 * the monorepo dev layout (this file under packages/shims/opencode/). A
 * `__dirname`-only resolution bricked every vendored install: the relative
 * hop landed on a nonexistent path and all writes failed closed.
 */
function resolveEnginePretooluse(startDir) {
  let dir = startDir;
  for (;;) {
    const vendored = path.join(dir, ".tenets", "engine", "events", "pretooluse.py");
    if (fs.existsSync(vendored)) return vendored;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fs.existsSync(DEV_LAYOUT_PRETOOLUSE) ? DEV_LAYOUT_PRETOOLUSE : null;
}

const WRITE_TOOLS = new Set(["write"]);
const EDIT_TOOLS = new Set(["edit"]);

/** Map an OpenCode tool call's args to a Claude-shaped {name, input} pair,
 * or null when this tool/arg shape is not one this gate covers. */
function claudeToolInputFor(toolName, args) {
  if (WRITE_TOOLS.has(toolName)) {
    if (typeof args.filePath !== "string" || typeof args.content !== "string") return null;
    return { name: "Write", input: { file_path: args.filePath, content: args.content } };
  }
  if (EDIT_TOOLS.has(toolName)) {
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

function findPython3() {
  const probe = spawnSync("python3", ["--version"]);
  return probe.error ? null : "python3";
}

/** Walk up from startDir looking for a .tenets/config.toml, mirroring
 * config.find()'s own upward search. */
function hasTenets(startDir) {
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
function failClosedOrAllow(cwd, detail) {
  if (hasTenets(cwd)) {
    throw new Error(`[portable-hooks] ${detail} Refusing to allow an unchecked edit.`);
  }
  return undefined;
}

async function PortableHooksPlugin(ctx) {
  const context = ctx || {};
  return {
    "tool.execute.before": async (input, output) => {
      const toolName = input && input.tool;
      const mapped = claudeToolInputFor(toolName, (output && output.args) || {});
      if (mapped === null) return; // not a write/edit call this gate covers

      const cwd = context.directory || process.cwd();
      const python3 = findPython3();
      if (python3 === null) {
        return failClosedOrAllow(
          cwd,
          "python3 is not installed, but this project's .tenets/ enables gating. " +
            "Install python3 (python.org), then retry.",
        );
      }

      const engine = resolveEnginePretooluse(cwd);
      if (engine === null) {
        return failClosedOrAllow(
          cwd,
          "the gate engine was not found — no .tenets/engine/ above the working " +
            "directory and no dev layout. Re-run `portable-hooks init`, then retry.",
        );
      }

      const payload = JSON.stringify({ tool_name: mapped.name, tool_input: mapped.input });
      const result = spawnSync(python3, [engine], {
        input: payload,
        encoding: "utf8",
        timeout: SUBPROCESS_TIMEOUT_MS,
      });

      const engineFailed = Boolean(result.error) || result.signal !== null || result.status !== 0;
      if (engineFailed) {
        const why = result.error ? result.error.message : `exited via signal ${result.signal || result.status}`;
        return failClosedOrAllow(
          cwd,
          `the gate engine did not respond (${why}). Check that ${engine} runs under python3, then retry.`,
        );
      }

      const out = (result.stdout || "").trim();
      if (!out) return; // silent allow: clean write

      let verdict;
      try {
        verdict = JSON.parse(out);
      } catch (err) {
        return failClosedOrAllow(cwd, `the gate engine printed unparseable output (${err.message}).`);
      }

      const hookOutput = (verdict && verdict.hookSpecificOutput) || {};
      if (hookOutput.permissionDecision === "deny") {
        throw new Error(hookOutput.permissionDecisionReason || "portable-hooks denied this edit");
      }
      if (hookOutput.permissionDecision === "allow" && hookOutput.updatedInput) {
        const updated = hookOutput.updatedInput;
        if (typeof updated.content === "string") output.args.content = updated.content;
        if (typeof updated.new_string === "string") output.args.newString = updated.new_string;
      }
    },
  };
}

module.exports = { PortableHooksPlugin, default: PortableHooksPlugin };
