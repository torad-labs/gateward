#!/usr/bin/env bun
/**
 * Canonical repository-wide rule-violation audit.
 *
 * Run as `bun packages/core/src/audit.ts <project-root> [--json]`.
 *
 * This is not a gate — it is a report. Where `events/pretooluse.ts` judges one
 * projected edit, this command scans a project's *entire current on-disk
 * state*: it resolves `.tenets/config.toml` exactly like the hook does
 * (enabled packs, `default_enabled`, per-rule `tier`/`enabled` overrides, and
 * each rule's own `files:`/`ignores:` scoping), walks every file the project
 * gates by extension (skipping `build/`, `.git/`, `.gradle/`, and
 * `node_modules/` at any depth), and tallies ast-grep matches per rule id.
 *
 * **This command defines THE canonical audit number.** CI pins its output and
 * the stage quotes it verbatim, so the count must be stable, reproducible, and
 * actually correct — not an approximation.
 *
 * Why this does not call `scan()` directly: `scan()` is built for the hook's
 * job — judging *hypothetical* content that may not match anything on disk —
 * so it copies content into a temp path first. That copy keeps only the
 * file's project-relative shape, never its real location. This audit's
 * content is never hypothetical: every file already exists at its real path,
 * and several authored rules depend on that path (`files: ['**\/domain\/**']`
 * and friends). `scanFile` below reuses scan's rule-loading and subprocess
 * plumbing but invokes ast-grep directly against each file's real path.
 *
 * Excluding ast-grep's own built-in diagnostics: ast-grep ships diagnostics
 * that are not authored rules — e.g. `unused-suppression` — which must never
 * contribute to this count (a single suppression comment can multiply into
 * several diagnostic hits across separately-scanned packs). This command
 * builds an explicit allowlist of rule ids actually authored in the enabled
 * packs (each rule file's own `id:` field) and discards any match whose rule
 * id is not in that set, regardless of how the scan was invoked.
 *
 * Output: human-readable table by default; `--json` prints
 * `{"total": int, "per_rule": {rule_id: count}, "files_scanned": int}`.
 * Rules with zero matches are omitted from `per_rule`. Exit code is always 0
 * — this command reports, it does not pass/fail.
 */
import * as path from "node:path";
import { type Config, find } from "./config";
import { AstGrepMissing, exec, inlineRules, type Match, toMatches } from "./scan";

/** Splits rule-file text into lines, tolerating CRLF line endings. */
const RULE_FILE_LINE_SPLIT_RE = /\r?\n/;

/** Directories never descended into, at any depth. `node_modules` matters
 * once TypeScript is a gated language: vendored `.d.ts` files under it would
 * otherwise be scanned as project code. */
export const SKIP_DIRS = new Set(["build", ".git", ".gradle", "node_modules"]);

/**
 * The rule ids actually authored in `config`'s enabled packs.
 *
 * Anything ast-grep reports that is not in this set — e.g. its built-in
 * `unused-suppression` hint — is not one of ours and must not be counted.
 */
export async function authoredRuleIds(config: Config): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const ruleFile of config.ruleFiles()) {
    // biome-ignore lint/performance/noAwaitInLoops: small, fixed rule-file set; sequential reads keep this simple
    const ruleId = await readRuleId(ruleFile);
    if (ruleId) ids.add(ruleId);
  }
  return ids;
}

/** Read a rule YAML file's top-level `id:` field. Narrow line-oriented read,
 * deliberately not a YAML parser — same style as config's pack.yml scan:
 * rule files are small and self-authored, and only the one top-level
 * (column-0) `id:` line is ever needed. */
async function readRuleId(ruleFile: string): Promise<string | null> {
  const text = await Bun.file(ruleFile).text();
  for (const rawLine of text.split(RULE_FILE_LINE_SPLIT_RE)) {
    if (rawLine.startsWith("id:")) return rawLine.slice("id:".length).trim();
  }
  return null;
}

/**
 * Every file under `root` this config gates, sorted for determinism. Walks
 * the full tree (pruning SKIP_DIRS segments at any depth).
 */
export async function gatedFiles(root: string, config: Config): Promise<string[]> {
  const found: string[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const rel of glob.scan({ cwd: root, onlyFiles: true, dot: true })) {
    const parts = rel.split(path.sep);
    if (parts.some((part) => SKIP_DIRS.has(part))) continue;
    if (!config.gates(rel)) continue;
    found.push(path.join(root, rel));
  }
  return found.sort();
}

/** Scan the real, on-disk file at `filePath` (not a temp copy — see module
 * doc) and return its enabled, tier-resolved Match list. */
export async function scanFile(filePath: string, config: Config): Promise<Match[]> {
  const rules = await inlineRules(config);
  const result = exec(["scan", "--inline-rules", rules, "--json=compact", filePath]);
  const raw = JSON.parse(result.stdout?.toString() || "[]");
  return toMatches(raw, config);
}

export interface AuditResult {
  perRule: Map<string, number>;
  total: number;
  filesScanned: number;
}

/**
 * Scan `projectRoot` and return per-rule counts (authored rules that actually
 * matched only — see module doc). Returns all-zero when `projectRoot` has no
 * `.tenets/config.toml` — same as the hook's "not installed here" allow.
 * `options.scanFile` is a test seam: the non-authored-id exclusion test
 * injects a scanner that emits matches no pack authored.
 */
export async function runAudit(
  projectRoot: string,
  options: { scanFile?: typeof scanFile } = {},
): Promise<AuditResult> {
  const scanOne = options.scanFile ?? scanFile;
  const config = await find(projectRoot);
  const perRule = new Map<string, number>();
  if (config === null) {
    return { perRule, total: 0, filesScanned: 0 };
  }

  const allowedIds = await authoredRuleIds(config);
  let filesScanned = 0;
  for (const filePath of await gatedFiles(projectRoot, config)) {
    let matches: Match[];
    try {
      // biome-ignore lint/performance/noAwaitInLoops: sequential so a missing ast-grep binary is caught after exactly `filesScanned` files, not an unpredictable subset
      matches = await scanOne(filePath, config);
    } catch (error) {
      if (error instanceof AstGrepMissing) {
        console.error(`[audit] ast-grep is not installed; stopped after ${filesScanned} file(s) scanned.`);
        break;
      }
      throw error;
    }
    filesScanned += 1;
    for (const match of matches) {
      if (allowedIds.has(match.ruleId)) {
        perRule.set(match.ruleId, (perRule.get(match.ruleId) ?? 0) + 1);
      }
    }
  }

  let total = 0;
  for (const count of perRule.values()) total += count;
  return { perRule, total, filesScanned };
}

export function renderHuman({ perRule, total, filesScanned }: AuditResult): string {
  const lines: string[] = [];
  let width = "rule".length;
  for (const ruleId of perRule.keys()) width = Math.max(width, ruleId.length);
  lines.push(`${"rule".padEnd(width)}  count`);
  lines.push(`${"-".repeat(width)}  -----`);
  for (const ruleId of [...perRule.keys()].sort()) {
    lines.push(`${ruleId.padEnd(width)}  ${perRule.get(ruleId)}`);
  }
  lines.push("");
  lines.push(`files scanned: ${filesScanned}`);
  lines.push(`total violations: ${total}`);
  return lines.join("\n");
}

export function renderJson({ perRule, total, filesScanned }: AuditResult): string {
  const perRuleObj: Record<string, number> = {};
  for (const ruleId of [...perRule.keys()].sort()) {
    perRuleObj[ruleId] = perRule.get(ruleId) ?? 0;
  }
  return JSON.stringify({ total, per_rule: perRuleObj, files_scanned: filesScanned });
}

function usage(): never {
  console.error("usage: audit.ts <project-root> [--json]");
  process.exitCode = 2;
  throw new Error("usage");
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const json = args.includes("--json");
  const positionals = args.filter((a) => a !== "--json");
  if (positionals.length !== 1) usage();

  const [target] = positionals;
  if (target === undefined) usage();
  const result = await runAudit(target);
  console.log(json ? renderJson(result) : renderHuman(result));
}

if (import.meta.main) {
  await main();
}
