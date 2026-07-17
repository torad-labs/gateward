/** The harness registry — the single enumeration of supported harnesses.
 * Registry order is detection-display order; WIRE_ORDER is the order `init`
 * wires them (shim-vendoring adapters first, so their lock entries exist
 * before lock.json is built; Claude last, closest to the summary output). */
import * as fs from "node:fs";
import * as path from "node:path";
import type { HarnessDetection } from "../types";
import type { HarnessAdapter } from "./adapter";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { copilotAdapter } from "./copilot";
import { opencodeAdapter } from "./opencode";

export const HARNESSES: readonly HarnessAdapter[] = [claudeAdapter, codexAdapter, opencodeAdapter, copilotAdapter];

export const WIRE_ORDER: readonly HarnessAdapter[] = [codexAdapter, opencodeAdapter, copilotAdapter, claudeAdapter];

export function detectHarnesses(projectRoot: string): HarnessDetection[] {
  return HARNESSES.map((adapter) => {
    const signals = adapter.signals.filter((rel) => fs.existsSync(path.join(projectRoot, rel)));
    return { harness: adapter.id, detected: signals.length > 0, signals };
  });
}
