#!/usr/bin/env bun
/**
 * PreToolUse entrypoint.
 *
 * Reads a Claude Code PreToolUse payload on stdin and writes a verdict to
 * stdout (nothing = allow). The gate runs in stages: config -> projection ->
 * scan -> diff -> verdict. Each early return is a deliberate "not ours / not
 * enforcing / can't decide" allow — but that is only safe because it is a
 * *considered* allow reached by a check that ran successfully. Anything
 * unexpected — a malformed payload, a config that fails to load, a scanner
 * that fails to run — must never fall through to the same "allow" path by
 * virtue of a crash; main() wraps the whole evaluation so any such error
 * becomes a deny instead (fail closed, never fail open).
 */
import { type Config, find, TIER_AUTOFIX } from "../config";
import { newViolations } from "../diff";
import { EDIT, type Projection, project, type ToolInput, WRITE } from "../projection";
import { AstGrepFailed, AstGrepMissing, applyFix, type Match, scan } from "../scan";
import { allow, autofix, deny, type Verdict } from "../verdict";

export interface PreToolUsePayload {
  tool_name?: string;
  tool_input?: ToolInput;
}

/** Return a verdict object, or null to allow the tool call. */
export async function evaluate(payload: PreToolUsePayload): Promise<Verdict | null> {
  const toolName = payload.tool_name ?? "";
  if (toolName !== WRITE && toolName !== EDIT) {
    return allow(); // unknown tool
  }

  const toolInput = payload.tool_input ?? {};
  const path = toolInput.file_path;
  // An absent file_path is simply not actionable (allow). A *present but
  // non-string* file_path is a malformed payload for a tool we do enforce on
  // — deny rather than let it reach path.resolve/path.extname downstream and
  // crash (which the harness would treat as non-blocking, i.e. fail open).
  if (path !== undefined && typeof path !== "string") {
    return deny(
      "[portable-hooks] malformed tool_input: file_path must be a string. Refusing to allow unchecked edits.",
    );
  }
  if (!path) return allow();

  // Same guard for the content fields: a present-but-non-string content /
  // old_string / new_string is a malformed payload for a tool we enforce on.
  // Projection would otherwise coerce it (e.g. write a number to disk) or the
  // string ops downstream would throw — both fail open. Deny instead.
  const malformedField = firstMalformedContentField(toolName, toolInput);
  if (malformedField !== null) {
    return deny(
      `[portable-hooks] malformed tool_input: ${malformedField} must be a string. Refusing to allow unchecked edits.`,
    );
  }

  const config = await find(path);
  if (config === null) {
    return allow(); // no .tenets/: not installed here
  }

  if (!config.gates(path)) {
    return allow(); // a file type this project does not gate
  }

  const proj = await project(toolName, toolInput);
  if (proj === null) {
    return allow(); // undecidable edit: let the harness decide
  }

  // The scan AND the autofix rewrite both shell out to ast-grep, so both can
  // raise AstGrepMissing/AstGrepFailed. They share one try/catch: a scanner
  // that vanishes or times out during the autofix pass must fail closed with
  // the same specific reason as during scanning, not fall through to main()'s
  // generic wrapper (which would also deny, but with a vaguer message).
  try {
    const current = await scan(proj.current, proj.path, config);
    const projected = await scan(proj.projected, proj.path, config);

    const fresh = newViolations(current, projected);
    if (fresh.length === 0) return allow();

    // Anything not explicitly autofix-tier blocks (fail closed). If any
    // blocking violation is new, deny wins: we never autofix alongside a block.
    const blocking = fresh.filter((match) => match.tier !== TIER_AUTOFIX);
    if (blocking.length > 0) {
      return deny(denyReason(blocking));
    }

    return await runAutofix(proj, toolInput, config, current);
  } catch (error) {
    if (error instanceof AstGrepMissing) {
      // Config is present and gates this file, but the scanner is gone:
      // fail closed rather than wave the edit through unchecked.
      return deny(missingBinaryReason(config));
    }
    if (error instanceof AstGrepFailed) {
      // The scanner ran but did not complete (timeout/killed/truncated): we
      // cannot trust an empty or partial result as "no violations", nor an
      // unverified autofix rewrite as "fixed".
      return deny(scanFailedReason(error));
    }
    throw error;
  }
}

/** The name of the first content field that is present but not a string, or
 * null when every relevant field is a string (or absent). Write carries
 * `content`; Edit carries `old_string`/`new_string`. */
function firstMalformedContentField(toolName: string, toolInput: ToolInput): string | null {
  const nonString = (value: unknown) => value !== undefined && typeof value !== "string";
  if (toolName === WRITE && nonString(toolInput.content)) return "content";
  if (toolName === EDIT) {
    if (nonString(toolInput.old_string)) return "old_string";
    if (nonString(toolInput.new_string)) return "new_string";
  }
  return null;
}

/**
 * Applies the autofix rewrite and VERIFIES it actually removed the new
 * violations before allowing. A rule marked autofix-tier but without a `fix:`
 * rewrites nothing, so `applyFix` would return the still-violating content and
 * we would "allow" a dirty edit — a warning tier / side door. So: re-project
 * the tool call with the fixed field, re-scan the result, and if it still
 * introduces new violations relative to `current`, deny instead. Only a fix
 * that genuinely cleans the edit is allowed through.
 */
async function runAutofix(proj: Projection, toolInput: ToolInput, config: Config, current: Match[]): Promise<Verdict> {
  const fixed =
    proj.toolName === WRITE
      ? await applyFix(proj.projected, proj.path, config)
      : // Edit: fix only the newly written text. The new finding lives in
        // new_string, so fixing it in isolation leaves surrounding legacy
        // code untouched.
        await applyFix(toolInput.new_string ?? "", proj.path, config);

  const updatedInput = proj.toolName === WRITE ? { ...toolInput, content: fixed } : { ...toolInput, new_string: fixed };

  // Verify the fix: re-project with the fixed field and re-scan the result.
  const verifyProj = await project(proj.toolName, updatedInput);
  if (verifyProj !== null) {
    const rescanned = await scan(verifyProj.projected, verifyProj.path, config);
    if (newViolations(current, rescanned).length > 0) {
      return deny(autofixFailedReason());
    }
  }

  return autofix(proj.toolName === WRITE ? { content: fixed } : { new_string: fixed });
}

function autofixFailedReason(): string {
  return (
    "[portable-hooks] an autofix-tier rule matched but its rewrite did not remove the violation " +
    "(the rule likely has no `fix:`). Refusing to allow the edit unchanged — fix it by hand, or give " +
    "the rule a real fix."
  );
}

function denyReason(matches: Match[]): string {
  return matches.map((match) => `[${match.ruleId}] line ${match.line}: ${match.message}`).join("\n");
}

function missingBinaryReason(config: Config): string {
  const languages = config.languages.join(", ") || "configured";
  return (
    `[portable-hooks] ast-grep is not installed, but this project's .tenets/ enables ${languages} rules. ` +
    "Install it (bun add -g @ast-grep/cli, npm i -g @ast-grep/cli, or brew install ast-grep), then retry. " +
    "Refusing to allow unchecked edits."
  );
}

function scanFailedReason(error: AstGrepFailed): string {
  return `[portable-hooks] ${error.message}. Refusing to allow unchecked edits.`;
}

/** Any error not otherwise handled — a malformed .tenets/config.toml
 * throwing out of the TOML import, a JSON-parse failure on stdin, or
 * anything else unanticipated. This is the last line of defense for the
 * fail-closed contract: an uncaught throw here would crash the process, and
 * Claude Code treats a non-0/non-2 exit as *non-blocking* — i.e. fail open.
 * So main() never lets an exception escape; it converts it to a deny. */
function unexpectedErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `[portable-hooks] internal error while evaluating this edit: ${message}. Refusing to allow unchecked edits.`;
}

async function main(): Promise<void> {
  let result: Verdict | null;
  try {
    const payload = (await Bun.stdin.json()) as PreToolUsePayload;
    result = await evaluate(payload);
  } catch (error) {
    result = deny(unexpectedErrorReason(error));
  }
  if (result !== null) {
    console.log(JSON.stringify(result));
  }
}

if (import.meta.main) {
  await main();
}
