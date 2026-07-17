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

export const BINARY = "ast-grep";
const DEFAULT_TIMEOUT_MS = 30_000;

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
  const raw = await withTempFile(content, filePath, config, (tmp) => {
    const result = exec(["scan", "--inline-rules", rules, "--json=compact", tmp]);
    return JSON.parse(result.stdout?.toString() || "[]") as RawMatch[];
  });
  return toMatches(raw, config);
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

/** Concatenate the enabled rule files verbatim into one --inline-rules
 * document. Reading the bytes is not parsing them: ast-grep owns rule
 * semantics; the core only shuttles the text. */
export async function inlineRules(config: Config): Promise<string> {
  const docs: string[] = [];
  for (const rulePath of config.ruleFiles()) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential so the inline-rules document's rule order matches ruleFiles()'s sorted order
    docs.push(await Bun.file(rulePath).text());
  }
  return docs.join("\n---\n");
}

/** Reads `PORTABLE_HOOKS_AST_GREP_TIMEOUT_MS` if set (a positive number),
 * else the default. Same escape-hatch style as `PORTABLE_HOOKS_AST_GREP`
 * below — exists so tests can force a fast, real timeout-kill instead of
 * waiting on the production timeout. */
function timeoutMs(): number {
  const raw = Bun.env.PORTABLE_HOOKS_AST_GREP_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Run the ast-grep binary and return its result, having verified the
 * invocation actually completed (see module doc for why nonzero exit alone
 * is not failure). `PORTABLE_HOOKS_AST_GREP` overrides the binary name — an
 * escape hatch for nonstandard installs, and how tests simulate a missing
 * scanner. Throws `AstGrepMissing` when the binary isn't found, and
 * `AstGrepFailed` when it started but didn't run to completion. */
export function exec(args: string[]): ReturnType<typeof Bun.spawnSync> {
  const binary = Bun.env.PORTABLE_HOOKS_AST_GREP ?? BINARY;
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
  const tmpDir = path.join(os.tmpdir(), `portable-hooks-${crypto.randomUUID()}`);
  const tmp = path.join(tmpDir, rel);
  try {
    await Bun.write(tmp, content);
    return await fn(tmp);
  } finally {
    await Bun.$`rm -rf ${tmpDir}`.quiet();
  }
}
