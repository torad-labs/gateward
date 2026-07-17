#!/usr/bin/env bun
/**
 * PreToolUse entrypoint.
 *
 * Reads a Claude Code PreToolUse payload on stdin and writes a verdict to
 * stdout (nothing = allow). The gate runs in stages: config -> projection ->
 * scan -> diff -> verdict. Each early return is a deliberate "not ours / not
 * enforcing / can't decide" allow.
 */
import { type Config, find, TIER_AUTOFIX } from "../config";
import { newViolations } from "../diff";
import { EDIT, type Projection, project, type ToolInput, WRITE } from "../projection";
import { AstGrepMissing, applyFix, type Match, scan } from "../scan";
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
  if (!path) return allow();

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

  let current: Match[];
  let projected: Match[];
  try {
    current = await scan(proj.current, proj.path, config);
    projected = await scan(proj.projected, proj.path, config);
  } catch (error) {
    if (error instanceof AstGrepMissing) {
      // Config is present and gates this file, but the scanner is gone:
      // fail closed rather than wave the edit through unchecked.
      return deny(missingBinaryReason(config));
    }
    throw error;
  }

  const fresh = newViolations(current, projected);
  if (fresh.length === 0) return allow();

  // Anything not explicitly autofix-tier blocks (fail closed). If any blocking
  // violation is new, deny wins: we never autofix alongside a block.
  const blocking = fresh.filter((match) => match.tier !== TIER_AUTOFIX);
  if (blocking.length > 0) {
    return deny(denyReason(blocking));
  }

  return runAutofix(proj, toolInput, config);
}

async function runAutofix(proj: Projection, toolInput: ToolInput, config: Config): Promise<Verdict> {
  if (proj.toolName === WRITE) {
    const fixed = await applyFix(proj.projected, proj.path, config);
    return autofix({ content: fixed });
  }
  // Edit: fix only the newly written text. The new finding lives in
  // new_string, so fixing it in isolation leaves surrounding legacy code
  // untouched.
  const newString = toolInput.new_string ?? "";
  const fixed = await applyFix(newString, proj.path, config);
  return autofix({ new_string: fixed });
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

async function main(): Promise<void> {
  const payload = (await Bun.stdin.json()) as PreToolUsePayload;
  const result = await evaluate(payload);
  if (result !== null) {
    console.log(JSON.stringify(result));
  }
}

if (import.meta.main) {
  await main();
}
