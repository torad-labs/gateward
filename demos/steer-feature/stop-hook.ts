#!/usr/bin/env bun
/**
 * stop-hook.ts — a decision-level gate. Where the PreToolUse gate watches what
 * the agent WRITES, this watches what the agent DECIDES: specifically, its
 * decision to stop.
 *
 * When the agent declares it is done, Claude Code fires the Stop hook. We read
 * the feature backlog; if any item is still open (todo | in_flight), we block
 * the stop and hand the model the list of what's left. "Don't stop until you're
 * fully done" stops being a hopeful line in a prompt and becomes a mechanical
 * check the agent cannot talk its way past. This is declare-then-earn at the
 * session boundary: the agent may claim done, but an open ledger overrides the
 * claim.
 *
 * Loop safety: Claude Code sets `stop_hook_active` once a stop has already been
 * blocked by a Stop hook this turn. We honor it and allow the stop, so the
 * agent can never be trapped in an unbreakable block loop.
 *
 * Output shape: `{ decision: "block", reason }` blocks the stop and feeds the
 * reason back to the model. (Documented Stop-hook contract; the exact envelope
 * is worth confirming against a live install, same caveat as the PreToolUse
 * autofix shape.)
 */
import { findBacklog, openItems, readBacklog } from "./backlog";

export interface StopPayload {
  stop_hook_active?: boolean;
  cwd?: string;
}

export interface StopDecision {
  decision: "block";
  reason: string;
}

/** Return a block decision, or null to let the stop proceed. */
export function evaluateStop(payload: StopPayload): StopDecision | null {
  if (payload.stop_hook_active) return null; // already nudged once — never loop

  const file = findBacklog(payload.cwd ?? process.cwd());
  if (!file) return null; // no backlog here: not our concern, allow the stop

  const open = openItems(readBacklog(file));
  if (open.length === 0) return null; // everything is done or verified — earned

  const lines = open.map((item) => `  - ${item.id} [${item.status}] ${item.title}`);
  const reason =
    `You're about to stop, but the backlog still has ${open.length} open ` +
    `item(s). Finish them (or, if genuinely blocked, mark them and say why) ` +
    `before you stop:\n${lines.join("\n")}\n\n` +
    `Update status with: bun demos/steer-feature/backlog.ts set-status <id> done`;
  return { decision: "block", reason };
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.main) {
  const raw = await readStdin();
  let payload: StopPayload = {};
  try {
    payload = raw.trim() ? (JSON.parse(raw) as StopPayload) : {};
  } catch {
    payload = {};
  }
  const decision = evaluateStop(payload);
  if (decision) process.stdout.write(JSON.stringify(decision));
  process.exit(0);
}
