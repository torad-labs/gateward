#!/usr/bin/env bun
/**
 * bash-guard.ts — the counter-rule that closes the side door.
 *
 * The write-time gate watches Write and Edit. It does NOT watch Bash. So an
 * agent that is blocked from writing a violation can still author the file in a
 * scratch location and shell it into place — `mv /tmp/sneak.kt src/.../Foo.kt`
 * — and the gate never sees it. That is not hypothetical: a real coding agent,
 * blocked by low-precision rules on a training-engine codebase, wrote obfuscated
 * code to a scratchpad and then wrote a mover script to smuggle it in.
 *
 * You cannot enumerate every trick a generator will invent. But you can attach
 * the gate to the missing surface. This PreToolUse hook inspects Bash commands
 * and blocks any `mv`/`cp`/`install`/redirect whose DESTINATION is a file the
 * project would otherwise gate — because a file moved into a gated path had its
 * content judged by nobody. The fix it hands back is the honest one: write the
 * file directly, where the gate can see it.
 *
 * It reuses the engine's own `find` + `config.gates` so "gated file" means
 * exactly what it means on the write path — one definition, two surfaces.
 */
import { type Config, find } from "../../packages/core/src/config";
import { deny, type Verdict } from "../../packages/core/src/verdict";

export interface BashPayload {
  tool_name?: string;
  tool_input?: { command?: string };
}

/** Destination file paths that a shell command would create or overwrite.
 *  Deliberately narrow: the movers/redirects an agent reaches for to route
 *  around a write gate. */
export function destinations(command: string): string[] {
  const out: string[] = [];
  // `>` / `>>` redirect: the token after the operator is the destination.
  for (const match of command.matchAll(/>>?\s*("[^"]+"|'[^']+'|\S+)/g)) {
    out.push(strip(match[1]));
  }
  // mv/cp/install/rsync/ln: last positional token is the destination.
  for (const match of command.matchAll(
    /\b(?:mv|cp|install|rsync|ln)\b([^;&|]*)/g,
  )) {
    const args = match[1].trim().split(/\s+/).filter((a) => a && !a.startsWith("-"));
    if (args.length >= 2) out.push(strip(args[args.length - 1]));
  }
  return out;
}

function strip(token: string): string {
  return token.replace(/^['"]|['"]$/g, "");
}

/** Return a deny verdict if the Bash command routes a file into a gated path. */
export async function evaluateBash(payload: BashPayload): Promise<Verdict | null> {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command ?? "";
  if (!command) return null;

  const smuggled: string[] = [];
  const seen = new Set<string>();
  for (const dest of destinations(command)) {
    if (seen.has(dest)) continue;
    seen.add(dest);
    const config: Config | null = await find(dest);
    if (config?.gates(dest)) smuggled.push(dest);
  }
  if (smuggled.length === 0) return null;

  const reason =
    `This command moves content into a gated path without the gate seeing it:\n` +
    smuggled.map((dest) => `  - ${dest}`).join("\n") +
    `\n\nA file shelled into a gated location had its content judged by nobody — ` +
    `that is the write gate's blind spot, and routing around it is not allowed. ` +
    `Write the file directly with Write/Edit so the rules run on its contents.`;
  return deny(reason);
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.main) {
  const raw = await readStdin();
  let payload: BashPayload = {};
  try {
    payload = raw.trim() ? (JSON.parse(raw) as BashPayload) : {};
  } catch {
    payload = {};
  }
  const verdict = await evaluateBash(payload);
  if (verdict) process.stdout.write(JSON.stringify(verdict));
  process.exit(0);
}
