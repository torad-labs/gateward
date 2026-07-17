#!/usr/bin/env bun
/**
 * proof.ts — the talk's five claims, proven in one deterministic run.
 *
 * Every act pipes real payloads through the real engine and its companions.
 * No agent, no network, no flakiness: safe to run on a conference stage, and
 * anyone who clones the repo can run it at home.
 *
 *   Act 1  a violating write            -> blocked, with instructions
 *   Act 2  legacy tolerated             -> old finding never blocks;
 *                                          introducing a new one does
 *   Act 3  the side door                -> a Bash `mv` into a gated path is
 *                                          caught by the counter-guard
 *   Act 4  the stop decision            -> stopping with open work is blocked;
 *                                          finished work is allowed through
 *   Act 5  the same rule, two harnesses -> a Claude-style Write and a Codex
 *                                          apply_patch envelope produce the
 *                                          same verdict from the same rule
 *
 * Run: bun demos/talk-proof/proof.ts   (add --plain to drop color)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { evaluate } from "../../packages/core/src/events/pretooluse";
import { parseApplyPatch } from "../../packages/shims/codex/claude_compat";
import { evaluateBash } from "../side-door/bash-guard";
import { serializeBacklog } from "../steer-feature/backlog";
import { evaluateStop } from "../steer-feature/stop-hook";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const PACKS = `${REPO}/packs`;

const COLOR = process.stdout.isTTY === true && !process.argv.includes("--plain");
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const BLOCKED = c("1;31", "⛔ BLOCKED");
const ALLOWED = c("1;32", "✓ ALLOWED");
const label = (s: string) => c("1", s);

function act(n: number, title: string): void {
  console.log(`\n${label(`ACT ${n}`)}  ${title}`);
}
function line(verdict: "block" | "allow", detail: string): void {
  console.log(`   ${verdict === "block" ? BLOCKED : ALLOWED}  ${c("2", detail)}`);
}
function reasonOf(v: unknown): string {
  return (v as { hookSpecificOutput?: { permissionDecisionReason?: string } })
    ?.hookSpecificOutput?.permissionDecisionReason ?? "";
}
function firstRule(reason: string): string {
  return reason.match(/\[([a-z0-9-]+)\]/)?.[1] ?? "(none)";
}
function ruleSet(reason: string): string {
  return [...reason.matchAll(/\[([a-z0-9-]+)\]/g)].map((m) => m[1]).sort().join(" + ") || "(none)";
}

// A workspace with the packs enabled, mirroring what the CLI installs.
function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-proof-"));
  fs.mkdirSync(path.join(dir, ".tenets"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".tenets", "config.toml"),
    `[core]\nlanguages = ["kotlin"]\ndefault_tier = "deny"\n\n[packs]\npacks_dir = "${PACKS}"\nenabled = ["kotlin-best-practices", "android-architecture"]\n`,
  );
  return dir;
}

const VIOLATION_KT =
  "package com.example.domain\n\nimport android.content.Context\n\nclass Sneak(private val context: Context)\n";

console.log(label("The talk's five claims, proven — no agent, no network, deterministic."));

// ---------------------------------------------------------------- act 1 -----
{
  act(1, "A violating write is blocked, with instructions");
  const ws = makeWorkspace();
  const verdict = await evaluate({
    tool_name: "Write",
    tool_input: { file_path: path.join(ws, "app/domain/Sneak.kt"), content: VIOLATION_KT },
  });
  const reason = reasonOf(verdict);
  line(verdict ? "block" : "allow", reason.split("\n")[0] ?? "");
  fs.rmSync(ws, { recursive: true, force: true });
}

// ---------------------------------------------------------------- act 2 -----
{
  act(2, "Legacy findings never block; a new one does");
  const ws = makeWorkspace();
  const legacy = path.join(ws, "app/LegacyScreen.kt");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  // A ten-year-old file: it already contains a force-unwrap finding.
  fs.writeFileSync(
    legacy,
    "package com.example.app\n\nclass LegacyScreen {\n    val title = cached!!.title\n    fun render() { }\n}\n",
  );
  const touch = await evaluate({
    tool_name: "Edit",
    tool_input: {
      file_path: legacy,
      old_string: "fun render() { }",
      new_string: 'fun render() { draw("ok") }',
    },
  });
  line(touch ? "block" : "allow", "editing the file while the OLD finding stays: tolerated");
  const worsen = await evaluate({
    tool_name: "Edit",
    tool_input: {
      old_string: "fun render() { }",
      new_string: "fun render() { val t = cached!!.title }",
      file_path: legacy,
    },
  });
  line(worsen ? "block" : "allow", `introducing a NEW ${firstRule(reasonOf(worsen))} finding: stopped`);
  fs.rmSync(ws, { recursive: true, force: true });
}

// ---------------------------------------------------------------- act 3 -----
{
  act(3, "The side door: a Bash mv into a gated path is caught");
  const dest =
    `${REPO}/apps/golden/feature/favorites/domain/src/main/kotlin/` +
    `com/torad/openhouse/feature/favorites/domain/Sneak.kt`;
  const verdict = await evaluateBash({
    tool_name: "Bash",
    tool_input: { command: `mv /tmp/sneak.kt ${dest}` },
  });
  line(verdict ? "block" : "allow", "mv into a gated path: content judged by nobody, denied");
}

// ---------------------------------------------------------------- act 4 -----
{
  act(4, "The stop decision: open work blocks a stop; finished work doesn't");
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "talk-proof-stop-"));
  fs.mkdirSync(path.join(ws, ".tenets"), { recursive: true });
  const backlog = path.join(ws, ".tenets", "backlog.toml");
  const item = (status: "todo" | "done") => [
    { id: "F1", title: "the easy half", status: "done" as const, files: [], verify: "", notes: [] },
    { id: "F2", title: "the boring test", status, files: [], verify: "", notes: [] },
  ];
  fs.writeFileSync(backlog, serializeBacklog(item("todo")));
  const blocked = evaluateStop({ cwd: ws });
  line(blocked ? "block" : "allow", "stop attempted with F2 still open: sent back to work");
  fs.writeFileSync(backlog, serializeBacklog(item("done")));
  const allowed = evaluateStop({ cwd: ws });
  line(allowed ? "block" : "allow", "stop attempted with the backlog clear: allowed");
  fs.rmSync(ws, { recursive: true, force: true });
}

// ---------------------------------------------------------------- act 5 -----
{
  act(5, "The same rule, two harnesses: Write payload vs Codex apply_patch");
  const ws = makeWorkspace();
  const target = path.join(ws, "app/domain/Sneak.kt");
  const claude = await evaluate({
    tool_name: "Write",
    tool_input: { file_path: target, content: VIOLATION_KT },
  });
  const claudeRule = ruleSet(reasonOf(claude));
  line(claude ? "block" : "allow", `Claude-style Write: ${claudeRule}`);

  // The same change as a Codex apply_patch envelope, decoded by the shim's
  // own parser, then judged by the same engine.
  const patch =
    `*** Begin Patch\n*** Add File: ${target}\n` +
    VIOLATION_KT.split("\n").map((l) => `+${l}`).join("\n") +
    `\n*** End Patch`;
  const files = parseApplyPatch(patch);
  const projected = files[0].newLines.join("\n"); // Add File: full new content
  const codex = await evaluate({
    tool_name: "Write",
    tool_input: { file_path: files[0].path, content: projected },
  });
  const codexRule = ruleSet(reasonOf(codex));
  line(codex ? "block" : "allow", `Codex apply_patch, via the shim: ${codexRule}`);
  console.log(
    `   ${claudeRule === codexRule ? c("1;32", "SAME RULES, SAME VERDICT") : c("1;31", "MISMATCH")}  ${c("2", "one rule set, different harness protocols")}`,
  );
  fs.rmSync(ws, { recursive: true, force: true });
}

console.log(`\n${c("2", "Five claims, one command. Everything above ran the shipped code.")}`);
