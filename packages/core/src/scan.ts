/**
 * ast-grep invocation and result modelling.
 *
 * The core never parses rule YAML: it hands the enabled rule files to the
 * ast-grep binary and reads back compact JSON. `ast-grep scan` exits non-zero
 * when it *finds matches* — that is a normal, successful invocation, so a
 * nonzero exit code alone is never treated as failure and stdout is parsed
 * regardless. What IS a failure is the process not completing at all: killed
 * by the configured timeout, killed by any other signal, or truncated because
 * it exceeded the output buffer. `exec()` distinguishes these (see its doc)
 * and throws `AstGrepFailed` rather than let empty/partial stdout be read as
 * "zero matches" — a killed scan must never look like a clean one. Rule
 * *tier* is not present in that JSON (ast-grep does not surface rule
 * metadata), so tier is resolved from config — see `Config.tierFor`.
 */
import * as os from "node:os";
import * as path from "node:path";
import type { Config } from "./config";

const BINARY = "ast-grep";
/** Splits a rule file into lines, tolerating CRLF. */
const RULE_FILE_LINE_SPLIT_RE = /\r?\n/;
// Per-invocation ceiling for one ast-grep run over one file. A single-file
// scan is normally sub-second; this bounds a pathological hang. It must stay
// well under the wired hook timeout (30s — see claude.ts/codex.ts): the hook
// runs up to two scans plus an optional autofix, and on a timeout the engine
// denies (fail closed). If the *harness* killed the hook first it would treat
// that as non-blocking (fail open), so this value is a security parameter, not
// just a convenience. Overridable in tests via GATEWARD_AST_GREP_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 8000;

/** Thrown when the ast-grep binary is not on PATH. */
export class AstGrepMissing extends Error {
  constructor(options?: ErrorOptions) {
    super("ast-grep binary not found on PATH", options);
    this.name = "AstGrepMissing";
  }
}

/** Thrown when an ast-grep invocation did not run to completion — timed out,
 * was killed by a signal, or had its output truncated. Deliberately distinct
 * from "found matches" (see module doc): callers must fail closed on this,
 * never treat it as "no matches". */
export class AstGrepFailed extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`ast-grep invocation failed: ${reason}`, options);
    this.name = "AstGrepFailed";
  }
}

/** One rule match, with its tier resolved from config. */
export interface Match {
  ruleId: string;
  message: string;
  text: string;
  severity: string;
  /** 1-based. */
  line: number;
  tier: string;
}

interface RawMatch {
  ruleId?: string;
  message?: string;
  text?: string;
  severity?: string;
  range?: { start?: { line?: number } };
}

/**
 * Scan `content` with the project's enabled rules and return the enabled
 * Match list. Throws AstGrepMissing when the binary is absent, or
 * AstGrepFailed when it ran but did not complete (see exec()).
 */
export async function scan(content: string, filePath: string, config: Config): Promise<Match[]> {
  const rules = await inlineRules(config);
  // No enabled rules apply to this project: nothing to check, and invoking
  // ast-grep with an empty --inline-rules would error (nonzero + blank stdout),
  // which parseScanJson would — correctly — treat as a failed run. Short-
  // circuit to a clean result so an empty pack set is an allow, not a deny.
  if (rules.trim() === "") return [];
  const raw = await withTempFile(content, filePath, config, (tmp) => {
    const result = exec(["scan", "--inline-rules", rules, "--json=compact", tmp]);
    return parseScanJson(result);
  });
  return toMatches(raw, config);
}

/**
 * Parse ast-grep's `--json=compact` stdout, distinguishing "no matches" from a
 * failed run. ast-grep prints a JSON array on success (matches, or empty). A
 * blank stdout paired with a nonzero exit is a failed invocation — unparseable
 * or invalid rules print their error to stderr and nothing to stdout, and
 * `--inline-rules ""` does the same — so it must fail closed, never read as
 * zero matches. (A nonzero exit *with* JSON on stdout is the normal
 * matches-found case; that is handled by the non-blank branch.)
 */
function parseScanJson(result: ReturnType<typeof Bun.spawnSync>): RawMatch[] {
  const out = (result.stdout?.toString() ?? "").trim();
  if (out === "") {
    if (result.exitCode !== 0) {
      const err = (result.stderr?.toString() ?? "").trim().split("\n")[0] ?? "";
      throw new AstGrepFailed(`no output, exit ${result.exitCode}${err ? `: ${err}` : ""}`);
    }
    return [];
  }
  try {
    return JSON.parse(out) as RawMatch[];
  } catch {
    throw new AstGrepFailed(`unparseable JSON output (rules may be invalid): ${out.slice(0, 200)}`);
  }
}

/**
 * Return `content` with every fixable rule applied via `--update-all`.
 *
 * Rules without a `fix:` change nothing, so this rewrites only autofix-tier
 * matches. Throws AstGrepMissing when the binary is absent, or AstGrepFailed
 * when the `--update-all` invocation did not complete — in that case the temp
 * file's content is unverified (it may be untouched, or partially rewritten),
 * so it is never read back as "the fixed content"; exec() throwing before we
 * reach the read is what guarantees that.
 */
export async function applyFix(content: string, filePath: string, config: Config): Promise<string> {
  const rules = await inlineRules(config);
  // No enabled rules → nothing to rewrite; return content untouched rather
  // than invoke ast-grep with an empty rule set. (In practice applyFix is
  // only reached when a fresh autofix-tier match exists, so this is a guard,
  // not a common path.) `inlineRules` already dropped disabled rules, so
  // `--update-all` can never apply a default-off rule's fix — see #3.
  if (rules.trim() === "") return content;
  return withTempFile(content, filePath, config, async (tmp) => {
    exec(["scan", "--inline-rules", rules, "--update-all", tmp]);
    return await Bun.file(tmp).text();
  });
}

/** Shared shaping of ast-grep's compact JSON into enabled, tier-resolved
 * matches — used by scan() above and by the audit's real-path scanning. */
export function toMatches(raw: RawMatch[], config: Config): Match[] {
  const matches: Match[] = [];
  for (const item of raw) {
    const ruleId = item.ruleId ?? "";
    if (!config.ruleEnabled(ruleId)) continue;
    matches.push({
      ruleId,
      message: item.message ?? ruleId,
      text: item.text ?? "",
      severity: item.severity ?? "error",
      line: (item.range?.start?.line ?? -1) + 1,
      tier: config.tierFor(ruleId),
    });
  }
  return matches;
}

/** A rule file's top-level `id:` (the first column-0 `id:` line), or null.
 * The same narrow line read the audit uses — not a YAML parse — needed to
 * drop disabled rules before they reach ast-grep. */
async function ruleFileId(rulePath: string): Promise<string | null> {
  const text = await Bun.file(rulePath).text();
  for (const line of text.split(RULE_FILE_LINE_SPLIT_RE)) {
    if (line.startsWith("id:")) return line.slice("id:".length).trim();
  }
  return null;
}

/** Concatenate the ENABLED rule files into one --inline-rules document.
 * Disabled rules (a pack's `default_enabled: false` without an enabling
 * override) are dropped HERE, before ast-grep runs — so a default-off rule
 * can neither surface a match under `--json` nor apply its `fix:` under
 * `--update-all` (#3: `toMatches` post-filters the scan path, but
 * `--update-all` has no post-filter, so the drop must happen pre-invocation).
 * Reading each file's `id:` is the same narrow read the audit does, not a
 * YAML parse; ast-grep still owns rule semantics. */
export async function inlineRules(config: Config): Promise<string> {
  const docs: string[] = [];
  for (const rulePath of config.ruleFiles()) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential so the inline-rules document's rule order matches ruleFiles()'s sorted order
    const id = await ruleFileId(rulePath);
    if (id !== null && !config.ruleEnabled(id)) continue;
    // biome-ignore lint/performance/noAwaitInLoops: sequential for the same rule-order reason as above
    docs.push(await Bun.file(rulePath).text());
  }
  return docs.join("\n---\n");
}

/** Reads `GATEWARD_AST_GREP_TIMEOUT_MS` if set (a positive number),
 * else the default. Same escape-hatch style as `GATEWARD_AST_GREP`
 * below — exists so tests can force a fast, real timeout-kill instead of
 * waiting on the production timeout. */
function timeoutMs(): number {
  const raw = Bun.env.GATEWARD_AST_GREP_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Run the ast-grep binary and return its result, having verified the
 * invocation actually completed (see module doc for why nonzero exit alone
 * is not failure). `GATEWARD_AST_GREP` overrides the binary name — an
 * escape hatch for nonstandard installs, and how tests simulate a missing
 * scanner. Throws `AstGrepMissing` when the binary isn't found, and
 * `AstGrepFailed` when it started but didn't run to completion. */
export function exec(args: string[]): ReturnType<typeof Bun.spawnSync> {
  const binary = Bun.env.GATEWARD_AST_GREP ?? BINARY;
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync({ cmd: [binary, ...args], timeout: timeoutMs() });
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: cause IS threaded through — AstGrepMissing's constructor forwards { cause } to super() — biome's heuristic wants a two-arg new Error(msg, opts) shape and doesn't recognize this single-arg options-only subclass constructor
    if ((error as { code?: string }).code === "ENOENT") throw new AstGrepMissing({ cause: error });
    throw error;
  }
  // Empirically verified (Bun 1.3.14): a timeout-kill sets exitedDueToTimeout
  // true with exitCode null; a normal completion — even the nonzero exit
  // ast-grep uses to report matches found — always has exitedDueToTimeout
  // false and a numeric exitCode. exitCode is only ever null when the
  // process didn't exit normally (timeout or any other signal), so checking
  // it alone would suffice, but the explicit flags make the intent (and the
  // distinct failure reasons) legible.
  if (result.exitedDueToTimeout) {
    throw new AstGrepFailed(`timed out after ${timeoutMs()}ms`);
  }
  if (result.exitedDueToMaxBuffer) {
    throw new AstGrepFailed("output exceeded the buffer limit (stdout may be truncated)");
  }
  if (result.exitCode === null) {
    throw new AstGrepFailed(`process was killed (signal ${result.signalCode ?? "unknown"})`);
  }
  return result;
}

/**
 * Mirror the file's project-relative path under a temp dir. Rule-level
 * files:/ignores: globs (e.g. **\/domain\/**, **\/test\/**) match on path
 * shape; a bare temp name would erase it and those rules could never fire.
 */
async function withTempFile<T>(
  content: string,
  filePath: string,
  config: Config,
  fn: (tmp: string) => T | Promise<T>,
): Promise<T> {
  const root = path.resolve(config.configDir, "..");
  const resolved = path.resolve(filePath);
  const relative = path.relative(root, resolved);
  const rel = relative.startsWith("..") || path.isAbsolute(relative) ? path.basename(filePath) : relative;
  // Canonicalize the extension to lowercase for the temp file. `config.gates`
  // matches extensions case-insensitively (a `.KT` write IS gated as Kotlin —
  // finding #7), but ast-grep's own language detection is case-SENSITIVE:
  // given `Foo.KT` it parses nothing and returns zero matches, silently
  // letting the edit through. Lowercasing only the extension keeps the
  // directory shape (so files:/ignores: globs still match) while letting the
  // scanner detect the language the gate already committed to.
  const ext = path.extname(rel);
  const canonicalRel = ext === "" ? rel : rel.slice(0, -ext.length) + ext.toLowerCase();
  const tmpDir = path.join(os.tmpdir(), `gateward-${crypto.randomUUID()}`);
  const tmp = path.join(tmpDir, canonicalRel);
  try {
    await Bun.write(tmp, content);
    return await fn(tmp);
  } finally {
    await Bun.$`rm -rf ${tmpDir}`.quiet();
  }
}
