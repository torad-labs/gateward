#!/usr/bin/env bun
/**
 * stop-hook.ts — a decision-level gate. Where the PreToolUse gate watches what
 * the agent WRITES, this watches what the agent DECIDES: specifically, its
 * decision to stop.
 *
 * When the agent declares it is done, Claude Code fires the Stop hook. We read
 * the feature backlog; if any task is still open (todo | in_flight), we block
 * the stop and hand the model the count and the list of what's left. "Don't
 * stop until you're fully done" stops being a hopeful line in a prompt and
 * becomes a mechanical check the agent cannot talk its way past. This is
 * declare-then-earn at the session boundary: the agent may claim done, but an
 * open ledger overrides the claim.
 *
 * Two faces, one gate:
 *   - Piped JSON (how Claude Code invokes hooks) -> the plain JSON contract.
 *     No colors: the reason is read by a model and rendered by the TUI.
 *   - A human at a TTY (or `--pretty`) -> a colored status panel for live
 *     terminal demos: red when blocked with the remaining count, green when
 *     the backlog is clear.
 *
 * Loop safety: Claude Code sets `stop_hook_active` once a stop has already been
 * blocked by a Stop hook this turn. We honor it and allow the stop, so the
 * agent can never be trapped in an unbreakable block loop.
 */
import { countSummary, findBacklog, type Item, openItems, paint, readBacklog, statusBadge } from "./backlog";

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
    `You're about to stop, but ${open.length} task(s) are still open ` +
    `(${countSummary(open)}):\n${lines.join("\n")}\n\n` +
    `Finish them (or, if genuinely blocked, add a note saying why) before ` +
    `stopping. Update status with: bun backlog.ts set-status <id> done`;
  return { decision: "block", reason };
}

/** The human-facing panel for live terminal demos (colors via backlog.paint). */
export function renderPretty(items: Item[]): string {
  const open = openItems(items);
  if (open.length === 0) {
    const earned = items.length ? ` (${countSummary(items)})` : "";
    return paint("1;32", `✓ STOP ALLOWED — backlog clear${earned}`);
  }
  const header = paint("1;41;97", ` ⛔ STOP BLOCKED `) + " " + paint("1;31", `${open.length} task(s) remaining`) + paint("2", ` (${countSummary(open)})`);
  const rows = open.map((item) => `   ${paint("1", item.id)}  ${statusBadge(item.status)} ${item.title}`);
  const hint = paint("2", "→ finish them, then stop:  bun backlog.ts set-status <id> done");
  return [header, ...rows, hint].join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const humanAtTty = process.stdin.isTTY === true;

  if (argv.includes("--pretty") || humanAtTty) {
    // Live-demo face: read the local backlog directly, print the panel.
    const file = findBacklog();
    if (!file) {
      console.log(paint("2", "no .tenets/backlog.toml here — nothing to gate"));
      process.exit(0);
    }
    console.log(renderPretty(readBacklog(file)));
    process.exit(0);
  }

  // Hook face: the exact JSON contract, nothing else on stdout.
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
