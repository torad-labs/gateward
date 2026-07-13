/** Harness detection: presence of a harness's directory or config file in the
 * target project. Detection is purely informational (reported to the user);
 * it does not gate whether `init` wires a harness — see commands/init.ts. */
import * as fs from "node:fs";
import * as path from "node:path";
import type { HarnessDetection, HarnessName } from "./types";

const SIGNALS: Record<HarnessName, string[]> = {
  claude: [".claude", ".claude/settings.json"],
  codex: [".codex", ".codex/hooks.json"],
  opencode: [".opencode"],
};

export function detectHarnesses(projectRoot: string): HarnessDetection[] {
  return (Object.keys(SIGNALS) as HarnessName[]).map((harness) => {
    const signals = SIGNALS[harness].filter((rel) => fs.existsSync(path.join(projectRoot, rel)));
    return { harness, detected: signals.length > 0, signals };
  });
}
