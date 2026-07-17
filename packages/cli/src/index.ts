#!/usr/bin/env bun
/**
 * Entrypoint: command dispatch only. This file is the SOLE owner of the
 * process exit code and (together with cli/ui.ts) of stdout — commands
 * return a CommandOutcome and never print or exit themselves. Enforced by
 * architecture.test.ts.
 */
import { HELP_TEXT, parseFlags } from "./cli/args";
import { CliError, usageError } from "./cli/errors";
import { renderTable } from "./cli/ui";
import { runAdd } from "./commands/add";
import { runAudit } from "./commands/audit";
import { runDoctor } from "./commands/doctor";
import { runInit } from "./commands/init";
import { runRemove } from "./commands/remove";
import { runUpdate } from "./commands/update";
import { projectRoot, readCliVersion } from "./paths";
import type { DoctorCheck } from "./types";

function printDoctor(checks: DoctorCheck[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(checks, null, 2));
    return;
  }
  const rows = checks.map((c) => [
    `[${c.status.toUpperCase()}]`,
    c.name,
    c.message + (c.remedy ? ` (remedy: ${c.remedy})` : ""),
  ]);
  console.log(renderTable(rows));
}

async function handleInit(rest: string[]): Promise<void> {
  const { values } = parseFlags(rest, {
    flags: {
      packs: { type: "string" },
      yes: { type: "boolean", short: "y" },
    },
  });
  const outcome = await runInit(projectRoot(), {
    packsFlag: values.packs as string | undefined,
    yes: Boolean(values.yes),
  });
  console.log(outcome.lines.join("\n"));
}

async function handleDoctor(rest: string[]): Promise<void> {
  const { values } = parseFlags(rest, { flags: { json: { type: "boolean" } } });
  const checks = await runDoctor(projectRoot());
  printDoctor(checks, Boolean(values.json));
  process.exitCode = checks.some((c) => c.status === "fail") ? 1 : 0;
}

async function handleAudit(rest: string[]): Promise<void> {
  const { values } = parseFlags(rest, { flags: { json: { type: "boolean" } } });
  const run = await runAudit(projectRoot(), Boolean(values.json));
  if (run.message) {
    if (run.message.stream === "stdout") console.log(run.message.text);
    else console.error(run.message.text);
  }
  process.exitCode = run.status;
}

async function handleAdd(rest: string[]): Promise<void> {
  const { positionals } = parseFlags(rest, { allowPositionals: true });
  const packId = positionals[0];
  if (!packId) usageError("`add` requires a pack id, e.g. `portable-hooks add kotlin-best-practices`.");
  const outcome = await runAdd(projectRoot(), packId);
  console.log(outcome.lines.join("\n"));
}

async function handleRemove(rest: string[]): Promise<void> {
  const { positionals } = parseFlags(rest, { allowPositionals: true });
  const packId = positionals[0];
  if (!packId) usageError("`remove` requires a pack id, e.g. `portable-hooks remove kotlin-best-practices`.");
  const outcome = await runRemove(projectRoot(), packId);
  console.log(outcome.lines.join("\n"));
}

async function handleUpdate(rest: string[]): Promise<void> {
  parseFlags(rest, {});
  const outcome = await runUpdate(projectRoot());
  console.log(outcome.lines.join("\n"));
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  if (argv.length === 0) {
    console.log(HELP_TEXT);
    process.exitCode = 2;
    return;
  }
  if (argv[0] === "-h" || argv[0] === "--help") {
    console.log(HELP_TEXT);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(await readCliVersion());
    return;
  }

  const [command, ...rest] = argv;
  switch (command) {
    case "init":
      return handleInit(rest);
    case "doctor":
      return handleDoctor(rest);
    case "audit":
      return handleAudit(rest);
    case "add":
      return handleAdd(rest);
    case "remove":
      return handleRemove(rest);
    case "update":
      return handleUpdate(rest);
    default:
      console.error(`portable-hooks: unknown command "${command}"\n`);
      console.log(HELP_TEXT);
      process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(`portable-hooks: ${err.message}`);
    process.exitCode = err.exitCode;
    return;
  }
  console.error(`portable-hooks: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
});
