/**
 * ast-grep invocation and result modelling.
 *
 * The core never parses rule YAML: it hands the enabled rule files to the
 * ast-grep binary and reads back compact JSON. `ast-grep scan` exits non-zero
 * when it finds matches, so the exit code is ignored and stdout is parsed
 * instead. Rule *tier* is not present in that JSON (ast-grep does not surface
 * rule metadata), so tier is resolved from config — see `Config.tierFor`.
 */
import * as os from "node:os";
import * as path from "node:path";
import type { Config } from "./config";

export const BINARY = "ast-grep";
const TIMEOUT_MS = 30_000;

/** Thrown when the ast-grep binary is not on PATH. */
export class AstGrepMissing extends Error {
  constructor() {
    super("ast-grep binary not found on PATH");
    this.name = "AstGrepMissing";
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
 * Match list. Throws AstGrepMissing when the binary is absent.
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
 * matches. Throws AstGrepMissing when the binary is absent.
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
    docs.push(await Bun.file(rulePath).text());
  }
  return docs.join("\n---\n");
}

/** Run the ast-grep binary; exit code deliberately ignored (see module doc).
 * `PORTABLE_HOOKS_AST_GREP` overrides the binary name — an escape hatch for
 * nonstandard installs, and how tests simulate a missing scanner. */
export function exec(args: string[]): ReturnType<typeof Bun.spawnSync> {
  const binary = Bun.env.PORTABLE_HOOKS_AST_GREP ?? BINARY;
  try {
    return Bun.spawnSync({ cmd: [binary, ...args], timeout: TIMEOUT_MS });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") throw new AstGrepMissing();
    throw error;
  }
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
