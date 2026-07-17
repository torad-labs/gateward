#!/usr/bin/env bun
/**
 * End-to-end replay harness — the spike, institutionalized.
 *
 * Each case in `payloads/` is a Claude Code PreToolUse payload
 * (`*.payload.json`) paired with an expected verdict (`*.expected.json`)
 * and, for Edit cases, a starting file (`*.fixture.kt`). The runner builds a
 * throwaway workspace with a real `.tenets/config.toml` pointing at this
 * repo's packs, substitutes the `{{WORKSPACE}}` placeholder in each payload,
 * pipes it through the core PreToolUse entrypoint as a subprocess, and
 * asserts the verdict class (allow / deny / autofix). For deny it checks the
 * reason names the expected rule; for autofix it checks the rewritten input.
 * Exits non-zero on any mismatch.
 *
 * A payload whose `tool_name` is `apply_patch` is a Codex-shaped case: it is
 * piped through `packages/shims/codex/claude_compat.ts` instead of the core
 * entrypoint directly. That shim emits the same verdict JSON shape core
 * does, so classification below is unchanged either way.
 *
 * Zero-dependency; no network. Run: `bun e2e/run.ts`.
 */
import * as os from "node:os";
import * as path from "node:path";

const HERE = import.meta.dir;
const REPO = path.resolve(HERE, "..");
const CORE = path.join(REPO, "packages", "core", "src", "events", "pretooluse.ts");
const CODEX_SHIM = path.join(REPO, "packages", "shims", "codex", "claude_compat.ts");
const PACKS = path.join(REPO, "packs");
const PAYLOADS = path.join(HERE, "payloads");
// biome-ignore lint/security/noSecrets: not a secret — a literal template placeholder substituted into test payloads
const PLACEHOLDER = "{{WORKSPACE}}";

const CONFIG_TOML = `[core]
languages = ["kotlin", "typescript"]
default_tier = "deny"

[packs]
packs_dir = "${PACKS}"
enabled = ["kotlin-best-practices", "android-architecture", "android-best-practices", "android-opinionated", "bun-best-practices"]

[rules.no-assert-equals-boolean]
tier = "autofix"
`;

interface Expected {
  verdict: string;
  contains?: string;
  lines?: number;
  target?: string;
  scanner?: string;
  description?: string;
}

async function buildWorkspace(): Promise<string> {
  const workspace = path.join(os.tmpdir(), `portable-hooks-e2e-${crypto.randomUUID()}`);
  await Bun.write(path.join(workspace, ".tenets", "config.toml"), CONFIG_TOML);
  return workspace;
}

type Classified = ["allow" | "deny" | "autofix" | "unknown", unknown];

function classify(stdout: string): Classified {
  const text = stdout.trim();
  if (!text) return ["allow", null];
  const data = JSON.parse(text) as { hookSpecificOutput?: Record<string, unknown>; updatedInput?: unknown };
  const hookOutput = data.hookSpecificOutput ?? {};
  const decision = hookOutput.permissionDecision;
  if (decision === "deny") {
    return ["deny", hookOutput.permissionDecisionReason ?? ""];
  }
  if (decision === "allow") {
    const updated = hookOutput.updatedInput ?? data.updatedInput;
    if (updated !== undefined && updated !== null) return ["autofix", updated];
    return ["allow", null];
  }
  return ["unknown", text];
}

/** Verdict-kind matched "deny": check the reason names the expected rule
 * (and, if pinned, the expected violation-line count). */
function judgeDeny(expected: Expected, detail: unknown): [boolean, string] {
  const reason = typeof detail === "string" ? detail : "";
  const needle = expected.contains ?? "";
  if (!reason.includes(needle)) {
    return [false, `deny reason missing ${JSON.stringify(needle)}: ${JSON.stringify(reason)}`];
  }
  if (expected.lines !== undefined) {
    const count = reason.split("\n").filter((line) => line.trim()).length;
    if (count !== expected.lines) {
      return [false, `expected ${expected.lines} violation line(s), got ${count}`];
    }
  }
  return [true, ""];
}

/** Verdict-kind matched "autofix": check the rewritten input's target field
 * is present and contains the expected text. */
function judgeAutofix(expected: Expected, detail: unknown): [boolean, string] {
  const target = expected.target ?? "";
  if (typeof detail !== "object" || detail === null || !(target in (detail as Record<string, unknown>))) {
    return [false, `updatedInput missing ${JSON.stringify(target)}: ${JSON.stringify(detail)}`];
  }
  const value = (detail as Record<string, unknown>)[target];
  const needle = expected.contains ?? "";
  if (typeof value !== "string" || !value.includes(needle)) {
    return [false, `updatedInput.${target} missing ${JSON.stringify(needle)}: ${JSON.stringify(value)}`];
  }
  return [true, ""];
}

function judge(expected: Expected, kind: string, detail: unknown, stderr: string): [boolean, string] {
  const want = expected.verdict;
  if (kind !== want) {
    const note = stderr.trim() ? ` (stderr: ${stderr.trim()})` : "";
    return [false, `expected ${want}, got ${kind}${note}`];
  }
  if (want === "deny") return judgeDeny(expected, detail);
  if (want === "autofix") return judgeAutofix(expected, detail);
  return [true, ""];
}

interface CasePayload {
  tool_name?: string;
  tool_input?: { file_path?: string };
}

interface LoadedCase {
  payload: CasePayload;
  expected: Expected;
}

/** Reads one case's payload + expected verdict, substituting the workspace
 * placeholder into the payload, and materializes its fixture file (if any)
 * at the payload's target path before the entrypoint runs. */
async function loadCase(caseName: string, workspace: string): Promise<LoadedCase> {
  const payloadText = await Bun.file(path.join(PAYLOADS, `${caseName}.payload.json`)).text();
  const payload = JSON.parse(payloadText.replaceAll(PLACEHOLDER, workspace)) as CasePayload;
  const expected = (await Bun.file(path.join(PAYLOADS, `${caseName}.expected.json`)).json()) as Expected;

  const fixture = Bun.file(path.join(PAYLOADS, `${caseName}.fixture.kt`));
  if (await fixture.exists()) {
    const target = payload.tool_input?.file_path;
    if (target) await Bun.write(target, await fixture.text());
  }

  return { payload, expected };
}

/** Runs the right subprocess entrypoint for one payload: Codex's `apply_patch`
 * shape goes through the Codex shim, everything else goes straight through
 * core's PreToolUse entrypoint. */
function spawnEntrypoint(payload: CasePayload, env: Record<string, string | undefined>) {
  const entrypoint = payload.tool_name === "apply_patch" ? CODEX_SHIM : CORE;
  return Bun.spawnSync({
    cmd: [process.execPath, entrypoint],
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    env,
    timeout: 60_000,
  });
}

async function runCase(caseName: string, workspace: string): Promise<[boolean, string]> {
  const { payload, expected } = await loadCase(caseName, workspace);

  const env: Record<string, string | undefined> = { ...Bun.env };
  if (expected.scanner === "absent") {
    env.PATH = "/nonexistent"; // make the ast-grep binary unfindable
  }

  const result = spawnEntrypoint(payload, env);
  const [kind, detail] = classify(result.stdout?.toString() ?? "");
  return judge(expected, kind, detail, result.stderr?.toString() ?? "");
}

async function main(): Promise<void> {
  const cases: string[] = [];
  const glob = new Bun.Glob("*.payload.json");
  for await (const name of glob.scan({ cwd: PAYLOADS })) {
    cases.push(name.slice(0, -".payload.json".length));
  }
  cases.sort();

  const workspace = await buildWorkspace();
  let failures = 0;
  try {
    for (const caseName of cases) {
      // biome-ignore lint/performance/noAwaitInLoops: cases run sequentially so PASS/FAIL lines print in stable case order
      const [passed, message] = await runCase(caseName, workspace);
      console.log(`${passed ? "PASS" : "FAIL"}  ${caseName}  ${message}`.trimEnd());
      if (!passed) failures += 1;
    }
  } finally {
    await Bun.$`rm -rf ${workspace}`.quiet();
  }

  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  process.exitCode = failures > 0 ? 1 : 0;
}

if (import.meta.main) {
  await main();
}
