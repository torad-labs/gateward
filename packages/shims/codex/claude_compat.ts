#!/usr/bin/env bun
// biome-ignore-all lint/style/noExcessiveLinesPerFile: one cohesive shim, vendored as a standalone file
/**
 * Run the portable-hooks PreToolUse gate against Codex's `apply_patch` tool.
 *
 * Ported from the author's personal Codex translator, simplified to this
 * product's scope: we only need to gate file edits, not every Claude
 * lifecycle event, so this file covers exactly one direction — Codex's
 * `apply_patch` PreToolUse call.
 *
 * Envelope shapes handled: Codex's PreToolUse payload names the tool
 * `apply_patch` and carries the patch as a `*** Begin Patch` ... `*** End
 * Patch` text envelope in `tool_input.command`. Two shapes of that field are
 * handled: a plain string, and the shell-array invocation form
 * `["apply_patch", "<patch text>"]` (the array element containing the
 * `*** Begin Patch` marker is used regardless of position). Anything else is
 * treated as not ours: silent allow. Codex's own harness validates the
 * envelope independently; this shim does not need to duplicate that.
 *
 * Per-file projection: each touched file becomes one Claude-shaped `Write`
 * call so core's projection module can do its normal on-disk-vs-projected
 * diff. `Add File` = the full new content; `Delete File` = empty content;
 * `Update File` = hunks located as contiguous context+removed blocks in the
 * on-disk file and replaced in order — a hunk with no context/removed lines
 * (a pure insertion) cannot be positioned from the data available, and a
 * hunk whose anchor is missing *or* not unique in the file cannot be
 * confidently placed either; any of these makes the file undecidable. An
 * undecidable file is NOT silently skipped: the whole apply_patch is denied
 * (see the fail-closed note below) rather than let the judged bytes diverge
 * from what Codex would actually land.
 * `*** Move to:` (rename-with-content-change) is out of scope.
 *
 * Per-file judging and merge: each projected file is handed to core's real
 * PreToolUse entrypoint as its own subprocess (same Bun runtime — the engine
 * is spawned via `process.execPath`). Any file's deny denies the whole patch,
 * reasons prefixed per file. An autofix-tier verdict degrades to deny: Codex
 * v1's apply_patch protocol has no channel to hand back a revised envelope
 * (documented product limitation, not a TODO). A file whose projection is
 * undecidable (null — see above) is treated the same as an explicit deny:
 * "can't decide" fails closed here, it does not fall through to allow. Every
 * file allowing (and none undecidable) = silent allow.
 *
 * Engine resolution is layout-aware: vendored installs live at
 * `.tenets/engine/shims/codex/` with the engine two levels up; the monorepo
 * dev layout lives at `packages/shims/codex/` with the engine under
 * `../../core/src/`. (The Python predecessor resolved only the dev layout —
 * a latent vendored-install break, fixed in this port.)
 */
import * as path from "node:path";

const SUBPROCESS_TIMEOUT_MS = 60_000;
const HOOK_EVENT = "PreToolUse";

const AUTOFIX_ROADMAP_REASON =
  "autofix-tier violation found, but Codex v1's apply_patch protocol has no " +
  "channel to hand back an updated patch envelope — fix this manually, or " +
  "make the edit through Claude Code where autofix can rewrite it in place.";

const ADD = "Add";
const UPDATE = "Update";
const DELETE = "Delete";

/** Splits patch text into lines, tolerating CRLF line endings. */
const PATCH_LINE_SPLIT_RE = /\r?\n/;

const FILE_HEADERS: [prefix: string, kind: string][] = [
  ["*** Add File: ", ADD],
  ["*** Update File: ", UPDATE],
  ["*** Delete File: ", DELETE],
];

interface PatchHunk {
  /** context + removed, pre-patch order */
  oldLines: string[];
  /** context + added, post-patch order */
  newLines: string[];
}

interface PatchFile {
  path: string;
  kind: string;
  /** Add: full new content */
  newLines: string[];
  /** Update: ordered hunks */
  hunks: PatchHunk[];
}

/** The Claude hook verdict shape, inlined rather than imported from the
 * engine: this shim's location relative to the engine differs between the
 * dev and vendored layouts, and the two-object contract is stable. */
function denyVerdict(reason: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** Locate core's pretooluse.ts for the layout this shim is running in. */
async function resolveEnginePretooluse(): Promise<string | null> {
  const candidates = [
    // Vendored: .tenets/engine/shims/codex/ -> .tenets/engine/events/
    path.resolve(import.meta.dir, "..", "..", "events", "pretooluse.ts"),
    // Monorepo dev layout: packages/shims/codex/ -> packages/core/src/events/
    path.resolve(import.meta.dir, "..", "..", "core", "src", "events", "pretooluse.ts"),
  ];
  for (const candidate of candidates) {
    // biome-ignore lint/performance/noAwaitInLoops: short-circuits on the first existing candidate; only two fixed layouts to check
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

interface CodexPayload {
  tool_name?: string;
  tool_input?: unknown;
  cwd?: string;
}

/** Return a verdict object, or null to allow. Kept separate from `main` so
 * tests can drive it without touching stdin/stdout, mirroring core's own
 * evaluate/main split. `options.invokeCore` is a test seam for driving the
 * merge logic without real engine subprocesses. */
export async function evaluate(
  payload: unknown,
  options: { invokeCore?: typeof invokeCore } = {},
): Promise<Record<string, unknown> | null> {
  const invoke = options.invokeCore ?? invokeCore;
  if (typeof payload !== "object" || payload === null) return null;
  const typed = payload as CodexPayload;
  if (typed.tool_name !== "apply_patch") return null;

  const patchText = extractPatchText(typed);
  if (!patchText) return null;

  const patchFiles = parseApplyPatch(patchText);
  if (patchFiles.length === 0) return null; // header-less/malformed envelope: silent allow

  const cwd = typed.cwd || process.cwd();
  const fileVerdicts: [string, string, unknown][] = [];
  for (const patchFile of patchFiles) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential so per-file deny reasons in the merged verdict stay in patch-file order
    const writeInput = await projectWriteInput(patchFile, cwd);
    if (writeInput === null) {
      // Undecidable projection: fail CLOSED rather than silently skipping the
      // file. A skip here would let merge() see zero verdicts for a real
      // edit — if every touched file skipped this way, merge() would return
      // its "no verdicts" allow, letting an unjudged apply_patch through.
      fileVerdicts.push([
        patchFile.path,
        "deny",
        `portable-hooks could not confidently determine what this apply_patch would write to ${patchFile.path}; refusing rather than allowing an unjudged edit`,
      ]);
      continue;
    }
    const [kind, detail] = await invoke(writeInput);
    fileVerdicts.push([patchFile.path, kind, detail]);
  }

  return merge(fileVerdicts);
}

export function extractPatchText(payload: CodexPayload): string {
  const toolInput = payload.tool_input;
  if (typeof toolInput === "string") {
    return toolInput.includes("*** Begin Patch") ? toolInput : "";
  }
  if (typeof toolInput !== "object" || toolInput === null) return "";
  return commandPatchText((toolInput as { command?: unknown }).command);
}

function commandPatchText(command: unknown): string {
  if (typeof command === "string") {
    return command.includes("*** Begin Patch") ? command : "";
  }
  if (Array.isArray(command)) {
    for (const item of command) {
      if (typeof item === "string" && item.includes("*** Begin Patch")) return item;
    }
  }
  return "";
}

/** Recognizes a `*** {Add,Update,Delete} File: <path>` header line and
 * returns its path + kind, or null for anything else. */
function matchFileHeader(raw: string): { path: string; kind: string } | null {
  for (const [prefix, kind] of FILE_HEADERS) {
    if (raw.startsWith(prefix)) return { path: raw.slice(prefix.length), kind };
  }
  return null;
}

/** Applies one content line of an in-progress Update-File hunk: `+`-prefixed
 * lines are additions, ` `-prefixed are context (kept on both sides), `-`-
 * prefixed are removals, and a bare empty line is a context line some
 * generators emit unprefixed — dropping it would break the anchor and
 * silently fail-open a patch Codex itself would apply fine, so it's kept. */
function applyUpdateLine(raw: string, currentHunk: PatchHunk | null, hunk: () => PatchHunk): void {
  if (raw.startsWith("+")) {
    hunk().newLines.push(raw.slice(1));
  } else if (raw.startsWith(" ")) {
    const h = hunk();
    h.oldLines.push(raw.slice(1));
    h.newLines.push(raw.slice(1));
  } else if (raw.startsWith("-")) {
    hunk().oldLines.push(raw.slice(1));
  } else if (raw === "" && currentHunk !== null) {
    currentHunk.oldLines.push("");
    currentHunk.newLines.push("");
  }
}

/** True if a hunk-in-progress has accumulated any old or new lines. */
function hunkHasLines(h: PatchHunk): boolean {
  return h.oldLines.length > 0 || h.newLines.length > 0;
}

/** Parse Add File / Update File / Delete File hunks. Unrecognized text (no
 * header lines at all) yields an empty list. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: hand-rolled patch-envelope state machine; header-matching, update-line, and hunk-length checks are already extracted — the remaining per-line dispatch reads clearest as one function
export function parseApplyPatch(text: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  let currentHunk: PatchHunk | null = null;

  const hunk = (): PatchHunk => {
    if (currentHunk === null) currentHunk = { oldLines: [], newLines: [] };
    return currentHunk;
  };

  const flushHunk = () => {
    if (current !== null && currentHunk !== null && hunkHasLines(currentHunk)) {
      current.hunks.push(currentHunk);
    }
    currentHunk = null;
  };

  const flushFile = () => {
    flushHunk();
    if (current !== null) files.push(current);
    current = null;
  };

  for (const raw of text.split(PATCH_LINE_SPLIT_RE)) {
    const header = matchFileHeader(raw);
    if (header !== null) {
      flushFile();
      current = { path: header.path, kind: header.kind, newLines: [], hunks: [] };
    } else if (raw.startsWith("*** End Patch")) {
      flushFile();
    } else if (raw.startsWith("@@")) {
      flushHunk();
    } else if (current === null) {
      // preamble outside any file section
    } else if (current.kind === ADD) {
      if (raw.startsWith("+")) current.newLines.push(raw.slice(1));
    } else if (current.kind === UPDATE) {
      applyUpdateLine(raw, currentHunk, hunk);
    }
  }

  flushFile();
  return files;
}

/** Counts non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  for (;;) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) return count;
    count++;
    idx += needle.length;
  }
}

/** Apply `hunks` against on-disk `content` in order. Returns the resulting
 * text, or null if the hunk cannot be confidently positioned:
 * - a hunk with no context/removed lines (a pure insertion) carries no
 *   anchor at all, so there is nothing to locate it against — the *whole*
 *   file's projection is undecidable, not a silent no-op (a dropped
 *   insertion would make the judged content match the on-disk file exactly,
 *   hiding the change from the engine entirely);
 * - a hunk whose anchor (its context+removed block) is missing from the
 *   file is a stale patch;
 * - a hunk whose anchor appears more than once is ambiguous — replacing the
 *   first occurrence could patch the wrong site, so the judged bytes could
 *   diverge from what Codex actually lands.
 * All three are left undecidable (null) rather than guessed at. */
export function applyHunks(content: string, hunks: PatchHunk[]): string | null {
  let result = content;
  for (const h of hunks) {
    if (h.oldLines.length === 0) return null;
    const anchor = h.oldLines.join("\n");
    const replacement = h.newLines.join("\n");
    if (anchor.length === 0 || countOccurrences(result, anchor) !== 1) return null;
    result = result.replace(anchor, replacement);
  }
  return result;
}

function resolvePath(rawPath: string, cwd: string): string {
  return path.isAbsolute(rawPath) ? rawPath : path.join(cwd, rawPath);
}

/** A Claude-shaped Write `tool_input` for one touched file, or null when the
 * change cannot be confidently projected. */
async function projectWriteInput(
  patchFile: PatchFile,
  cwd: string,
): Promise<{ file_path: string; content: string } | null> {
  const filePath = resolvePath(patchFile.path, cwd);
  if (patchFile.kind === ADD) {
    return { file_path: filePath, content: patchFile.newLines.join("\n") };
  }
  if (patchFile.kind === DELETE) {
    return { file_path: filePath, content: "" };
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  let current: string;
  try {
    current = await file.text();
  } catch {
    return null;
  }
  const projected = applyHunks(current, patchFile.hunks);
  if (projected === null) return null;
  return { file_path: filePath, content: projected };
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

/** Run core's pretooluse.ts against one synthetic Write payload and classify
 * the result as ["allow"|"deny"|"autofix", detail]. Fails closed (deny) if
 * the engine cannot be found or run, times out, or exits nonzero without an
 * explicit verdict — the same fail-closed stance core itself takes when it
 * cannot judge. */
async function invokeCore(writeInput: { file_path: string; content: string }): Promise<[string, unknown]> {
  const engine = await resolveEnginePretooluse();
  if (engine === null) {
    return ["deny", "portable-hooks core could not run: engine entrypoint not found in any known layout"];
  }
  const stdinPayload = JSON.stringify({ tool_name: "Write", tool_input: writeInput });
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

/** Merge per-file (path, kind, detail) verdicts into one Codex-shaped
 * verdict: any deny (or autofix, degraded — see module doc) wins, each
 * reason line prefixed with its file's path; otherwise allow. */
export function merge(fileVerdicts: [string, string, unknown][]): Record<string, unknown> | null {
  const denyLines: string[] = [];
  for (const [filePath, kind, detail] of fileVerdicts) {
    let reason: string;
    if (kind === "deny") {
      reason = typeof detail === "string" && detail ? detail : "denied";
    } else if (kind === "autofix") {
      reason = AUTOFIX_ROADMAP_REASON;
    } else {
      continue;
    }
    const lines = reason.split("\n").filter((line) => line.length > 0);
    for (const line of lines.length > 0 ? lines : [reason]) {
      denyLines.push(`${filePath}: ${line}`);
    }
  }

  if (denyLines.length > 0) {
    return denyVerdict(denyLines.join("\n"));
  }
  return null;
}

async function main(): Promise<void> {
  let payload: unknown;
  try {
    payload = await Bun.stdin.json();
  } catch {
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
