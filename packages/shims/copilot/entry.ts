#!/usr/bin/env bun
/**
 * Run the portable-hooks PreToolUse gate against GitHub Copilot's file tools.
 *
 * Copilot (the CLI, the cloud coding agent, and VS Code agent mode) reads
 * `preToolUse` command hooks from `.github/hooks/*.json`; the hook receives
 * one tool call on stdin and answers with a FLAT verdict object —
 * `{permissionDecision, permissionDecisionReason, modifiedArgs}` — unlike
 * Claude Code's `hookSpecificOutput` nesting. A deny blocks the write before
 * it reaches disk and the reason is fed back to the model in the same turn.
 *
 * Payload shapes handled: the camelCase form `{toolName, toolArgs}` (Copilot
 * CLI; `toolArgs` is documented as an object but observed as a JSON-encoded
 * string in Copilot's own hook-testing example, so both are accepted) and the
 * snake_case compat form `{tool_name, tool_input}` (the shape VS Code's hook
 * bridge emits). Tool-name matching is case-insensitive over {create, edit,
 * write}, covering Copilot's native file tools and the Claude-compat names.
 *
 * Arg-name honesty: Copilot's hook reference does not pin the arg names
 * inside `toolArgs` for `create`/`edit`. This shim maps every spelling the
 * surrounding ecosystem uses (filePath/file_path/path, content,
 * oldString/old_string/oldStr/old_str and their new-side mirrors) and FAILS
 * CLOSED on a gated tool whose args fit none of them — the deny reason lists
 * the arg keys that arrived so the gap is diagnosable. Same honesty stance as
 * the OpenCode plugin: ship what maps, refuse what doesn't, never wave an
 * unread edit through.
 *
 * Autofix: unlike Codex's apply_patch, Copilot's protocol HAS a rewrite
 * channel — `modifiedArgs` replaces the tool call's arguments wholesale. A
 * core autofix verdict (allow + updatedInput) is translated back into the
 * original arg spelling, so the fixed content lands through the same keys
 * the harness sent.
 *
 * Timeout is a security parameter with the OPPOSITE failure mode to a crash:
 * Copilot denies the call when a preToolUse hook crashes or exits non-zero
 * (fail closed) but proceeds when it times out (fail OPEN, documented). The
 * engine subprocess budget here (30s) must therefore stay comfortably under
 * the wired hook's `timeoutSec` (60s — see the CLI's copilot adapter) so a
 * hung engine surfaces as this shim's own explicit deny, never as a harness
 * timeout that waves the write through.
 *
 * Engine resolution is layout-aware, same two layouts as the Codex shim:
 * vendored installs live at `.tenets/engine/shims/copilot/` with the engine
 * two levels up; the monorepo dev layout lives at `packages/shims/copilot/`
 * with the engine under `../../core/src/`.
 */
import * as path from "node:path";

const SUBPROCESS_TIMEOUT_MS = 30_000;

/** Copilot's flat preToolUse deny verdict (no hookSpecificOutput nesting). */
function denyVerdict(reason: string): Record<string, unknown> {
  return { permissionDecision: "deny", permissionDecisionReason: reason };
}

/** Locate core's pretooluse.ts for the layout this shim is running in. */
async function resolveEnginePretooluse(): Promise<string | null> {
  const candidates = [
    // Vendored: .tenets/engine/shims/copilot/ -> .tenets/engine/events/
    path.resolve(import.meta.dir, "..", "..", "events", "pretooluse.ts"),
    // Monorepo dev layout: packages/shims/copilot/ -> packages/core/src/events/
    path.resolve(import.meta.dir, "..", "..", "core", "src", "events", "pretooluse.ts"),
  ];
  for (const candidate of candidates) {
    // biome-ignore lint/performance/noAwaitInLoops: short-circuits on the first existing candidate; only two fixed layouts to check
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

interface CopilotPayload {
  toolName?: unknown;
  toolArgs?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
}

/** Tool names this gate is responsible for, lowercased: Copilot CLI's native
 * file tools (`create`, `edit`) plus Claude-compat names a bridged payload
 * may carry (`write`; `Edit` lowercases into `edit`). */
const GATED_TOOLS = new Set(["create", "edit", "write"]);

function gatedToolName(payload: CopilotPayload): string | null {
  const raw = payload.toolName ?? payload.tool_name;
  if (typeof raw !== "string") return null;
  const lowered = raw.toLowerCase();
  return GATED_TOOLS.has(lowered) ? lowered : null;
}

/** The raw args object, decoding the JSON-string form Copilot's own hook
 * testing example uses. Returns null when args are absent or undecodable —
 * the caller fails closed on that for a gated tool. */
function rawArgs(payload: CopilotPayload): Record<string, unknown> | null {
  let args = payload.toolArgs ?? payload.tool_input;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

const PATH_KEYS = ["filePath", "file_path", "path"] as const;

/** Old/new arg-name pairs, mirrored spellings: whichever old-side key is
 * present picks its partner as the write-back key for autofixed content. */
const EDIT_KEY_PAIRS: readonly [old: string, replacement: string][] = [
  ["oldString", "newString"],
  ["old_string", "new_string"],
  ["oldStr", "newStr"],
  ["old_str", "new_str"],
];

interface MappedCall {
  /** Claude-shaped tool name + input for the engine. */
  name: "Write" | "Edit";
  input: Record<string, string>;
  /** The original-args key an autofixed content/new_string writes back to. */
  writeBackKey: string;
}

function findStringKey(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (typeof args[key] === "string") return key;
  }
  return null;
}

/** Map Copilot args to a Claude-shaped call by SHAPE, not tool name: an
 * old/new pair projects as an Edit, a content projects as a Write. The shape
 * decides the projection semantics regardless of which gated tool carried
 * it, so every casing/bridging variant behaves identically. Returns null
 * when neither shape fits — the caller fails closed. */
function mapToClaudeCall(args: Record<string, unknown>): MappedCall | null {
  const pathKey = findStringKey(args, PATH_KEYS);
  if (pathKey === null) return null;
  const filePath = args[pathKey] as string;

  for (const [oldKey, newKey] of EDIT_KEY_PAIRS) {
    const oldValue = args[oldKey];
    if (typeof oldValue !== "string") continue;
    const newValue = args[newKey];
    return {
      name: "Edit",
      input: {
        file_path: filePath,
        old_string: oldValue,
        new_string: typeof newValue === "string" ? newValue : "",
      },
      writeBackKey: newKey,
    };
  }

  if (typeof args.content === "string") {
    return { name: "Write", input: { file_path: filePath, content: args.content }, writeBackKey: "content" };
  }
  return null;
}

/** Parses and classifies core's raw subprocess output into
 * ["allow"|"deny"|"autofix", detail]. Fails closed (deny) on empty output
 * with a nonzero exit, or on unparseable JSON — the same fail-closed stance
 * core itself takes when it cannot judge. */
function classifyCoreOutput(stdout: string, exitCode: number | null): [string, unknown] {
  const out = stdout.trim();
  if (!out) {
    if (exitCode !== 0) {
      return ["deny", `portable-hooks core exited ${exitCode} with no verdict`];
    }
    return ["allow", null];
  }

  let data: unknown;
  try {
    data = JSON.parse(out);
  } catch {
    return ["deny", `portable-hooks core printed unparseable output: ${JSON.stringify(out)}`];
  }

  const hookOutput =
    typeof data === "object" && data !== null
      ? ((data as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {})
      : {};
  const decision = hookOutput.permissionDecision;
  if (decision === "deny") {
    return ["deny", hookOutput.permissionDecisionReason ?? "denied"];
  }
  if (decision === "allow" && "updatedInput" in hookOutput) {
    return ["autofix", hookOutput.updatedInput];
  }
  return ["allow", null];
}

/** Run core's pretooluse.ts against one Claude-shaped payload and classify
 * the result. Fails closed (deny) if the engine cannot be found or run,
 * times out, or exits nonzero without an explicit verdict. */
async function invokeCore(mapped: MappedCall): Promise<[string, unknown]> {
  const engine = await resolveEnginePretooluse();
  if (engine === null) {
    return ["deny", "portable-hooks core could not run: engine entrypoint not found in any known layout"];
  }
  const stdinPayload = JSON.stringify({ tool_name: mapped.name, tool_input: mapped.input });
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync({
      cmd: [process.execPath, engine],
      stdin: new TextEncoder().encode(stdinPayload),
      timeout: SUBPROCESS_TIMEOUT_MS,
    });
  } catch (exc) {
    return ["deny", `portable-hooks core could not run: ${(exc as Error).message}`];
  }

  return classifyCoreOutput(result.stdout?.toString() ?? "", result.exitCode);
}

/** An autofix verdict translated back into Copilot's flat shape: allow, with
 * the engine's fixed string written into the ORIGINAL args under the same
 * key spelling the harness sent (plus everything else untouched). */
function autofixVerdict(args: Record<string, unknown>, mapped: MappedCall, detail: unknown): Record<string, unknown> {
  const updated = (typeof detail === "object" && detail !== null ? detail : {}) as Record<string, unknown>;
  const fixed = mapped.name === "Write" ? updated.content : updated.new_string;
  if (typeof fixed !== "string") {
    // Core promised a rewrite but the payload carries none: refusing beats
    // allowing content that was judged fixable-but-not-fixed.
    return denyVerdict("portable-hooks core returned an autofix verdict without the rewritten content");
  }
  return { permissionDecision: "allow", modifiedArgs: { ...args, [mapped.writeBackKey]: fixed } };
}

/** Return a flat Copilot verdict object, or null for a silent allow. Kept
 * separate from `main` so tests can drive it without touching stdin/stdout;
 * `options.invokeCore` is a test seam, mirroring the Codex shim. The wired
 * matcher restricts this hook to file tools, so a payload that cannot even
 * be read as one is denied, not waved through. */
export async function evaluate(
  payload: unknown,
  options: { invokeCore?: typeof invokeCore } = {},
): Promise<Record<string, unknown> | null> {
  const invoke = options.invokeCore ?? invokeCore;
  if (typeof payload !== "object" || payload === null) {
    return denyVerdict("portable-hooks received an unreadable preToolUse payload; refusing to allow an unjudged edit");
  }
  const typed = payload as CopilotPayload;
  const toolName = gatedToolName(typed);
  if (toolName === null) return null; // genuinely not a file tool: not ours

  const args = rawArgs(typed);
  if (args === null) {
    return denyVerdict(
      `portable-hooks could not read the arguments of this ${toolName} call; refusing to allow an unjudged edit`,
    );
  }
  const mapped = mapToClaudeCall(args);
  if (mapped === null) {
    return denyVerdict(
      `portable-hooks could not map this ${toolName} call's arguments (got keys: ${Object.keys(args).sort().join(", ")}); ` +
        "refusing to allow an unjudged edit",
    );
  }

  const [kind, detail] = await invoke(mapped);
  if (kind === "deny") {
    return denyVerdict(typeof detail === "string" && detail ? detail : "portable-hooks denied this edit");
  }
  if (kind === "autofix") {
    return autofixVerdict(args, mapped, detail);
  }
  return null;
}

async function main(): Promise<void> {
  let payload: unknown;
  try {
    payload = await Bun.stdin.json();
  } catch {
    // Matcher-scoped: every invocation of this hook IS a file-tool call, so
    // unreadable stdin means an unjudgeable edit — fail closed.
    console.log(JSON.stringify(denyVerdict("portable-hooks received unparseable hook input on stdin")));
    return;
  }
  const result = await evaluate(payload);
  if (result !== null) {
    console.log(JSON.stringify(result));
  }
}

if (import.meta.main) {
  await main();
}
