/** Claude Code adapter: PreToolUse hook merged into `.claude/settings.json`. */
import * as path from "node:path";
import { writeIfChanged } from "../domain/vendor";
import type { DoctorCheck } from "../types";
import type { HarnessAdapter, WireContext, WireReport } from "./adapter";
import { type MergeResult, mergePreToolUseHook } from "./settingsMerge";

export const CLAUDE_HOOK_MARKER = ".tenets/engine/events/pretooluse.ts";

/** Merges the PreToolUse -> pretooluse.ts entry into a Claude Code settings.json.
 * The command runs the vendored entrypoint through bun explicitly: exec
 * bits do not survive every transport (zip downloads, some git configs), and
 * a hook that fails with exit 126 is a silently dead gate.
 *
 * `timeout` (30s) must exceed the engine's internal scan budget so the
 * engine's own fail-closed deny fires first. The engine runs up to two scans
 * plus an optional autofix, each bounded by scan.ts's DEFAULT_TIMEOUT_MS (8s);
 * if the harness killed the hook first it would treat that as non-blocking
 * (fail open), so this ceiling is a security parameter. */
export function mergeClaudeSettings(existingText: string | null): MergeResult {
  return mergePreToolUseHook(existingText, CLAUDE_HOOK_MARKER, {
    matcher: "Write|Edit",
    hooks: [{ type: "command", command: `bun "$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_MARKER}`, timeout: 30 }],
  });
}

async function wire({ root }: WireContext): Promise<WireReport> {
  const settingsPath = path.join(root, ".claude", "settings.json");
  const settingsFile = Bun.file(settingsPath);
  const existingText = (await settingsFile.exists()) ? await settingsFile.text() : null;
  let merged: MergeResult;
  try {
    merged = mergeClaudeSettings(existingText);
  } catch (err) {
    throw new Error(`.claude/settings.json exists but is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
  const result = await writeIfChanged(settingsPath, merged.text);
  return {
    lines: [`Claude Code wired -> .claude/settings.json (${merged.changed ? "added hook" : "already wired"})`],
    lockEntries: {},
    changed: result !== "unchanged",
  };
}

async function check(root: string): Promise<DoctorCheck> {
  const settingsFile = Bun.file(path.join(root, ".claude", "settings.json"));
  if (!(await settingsFile.exists())) {
    return {
      name: "harness:claude",
      status: "fail",
      message: ".claude/ detected but settings.json is missing.",
      remedy: "run `portable-hooks init`",
    };
  }
  const text = await settingsFile.text();
  if (text.includes(CLAUDE_HOOK_MARKER)) {
    return { name: "harness:claude", status: "pass", message: "Claude Code PreToolUse hook wired." };
  }
  return {
    name: "harness:claude",
    status: "fail",
    message: "Claude Code detected but the PreToolUse hook is not wired.",
    remedy: "run `portable-hooks init`",
  };
}

export const claudeAdapter: HarnessAdapter = {
  id: "claude",
  signals: [".claude", ".claude/settings.json"],
  wire,
  check,
};
