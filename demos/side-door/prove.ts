#!/usr/bin/env bun
/**
 * prove.ts — a deterministic, reproducible proof of the side-door story.
 *
 * No live agent, no network, no flakiness: it pipes real PreToolUse payloads
 * through the actual engine and the actual counter-guard, and prints the three
 * acts of the S25 slide.
 *
 *   Act 1  a direct Write of a domain violation           -> the gate BLOCKS
 *   Act 2  the same content shelled in with `mv`           -> the gate is BLIND
 *   Act 3  the same `mv`, now under the Bash counter-guard -> BLOCKED again
 *
 * The point isn't "we thought of mv." It's the shape: a generator will find the
 * surface you didn't gate, and the fix is to attach the gate to that surface —
 * which is code you evolve, not a config you set once.
 *
 * Run: bun demos/side-door/prove.ts     (add --plain to drop color)
 */
import { evaluate } from "../../packages/core/src/events/pretooluse";
import { evaluateBash } from "./bash-guard";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const DOMAIN_FILE =
  `${REPO}/apps/golden/feature/favorites/domain/src/main/kotlin/` +
  `com/torad/openhouse/feature/favorites/domain/Sneak.kt`;
const VIOLATION =
  "package com.torad.openhouse.feature.favorites.domain\n\n" +
  "import android.content.Context\n\n" +
  "class Sneak(private val context: Context)\n";

const COLOR = process.stdout.isTTY === true && !process.argv.includes("--plain");
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const BLOCKED = c("1;31", "⛔ BLOCKED");
const BLIND = c("1;33", "🕳  UNSEEN (allowed)");

function act(n: number, title: string): void {
  console.log(`\n${c("1", `ACT ${n}`)}  ${title}`);
}

function verdictLine(v: { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } } | null): void {
  if (!v) {
    console.log(`   ${BLIND}  the gate never ran on this content`);
    return;
  }
  const reason = v.hookSpecificOutput?.permissionDecisionReason ?? "";
  console.log(`   ${BLOCKED}`);
  for (const line of reason.split("\n")) console.log(c("2", `   ${line}`));
}

const writePayload = {
  tool_name: "Write",
  tool_input: { file_path: DOMAIN_FILE, content: VIOLATION },
};
const mvPayload = {
  tool_name: "Bash",
  tool_input: { command: `mv /tmp/sneak.kt ${DOMAIN_FILE}` },
};

console.log(c("1", "The side door — a determined agent vs. a write-time gate"));

act(1, "The agent writes the violation directly (Write → the gate sees it)");
verdictLine(await evaluate(writePayload));

act(2, "Blocked, it shells the file into place instead (Bash mv → the write gate is blind)");
verdictLine(await evaluate(mvPayload)); // the core engine only watches Write/Edit → allow

act(3, "We attach the gate to the missing surface (Bash counter-guard on)");
verdictLine(await evaluateBash(mvPayload)); // the identical command, now caught

console.log(
  `\n${c("2", "You cannot enumerate every trick. You can evolve the gate. Act 3 was one hook away.")}`,
);
