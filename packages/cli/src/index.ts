#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runAdd } from "./commands/add";
import { runAudit } from "./commands/audit";
import { runDoctor } from "./commands/doctor";
import { runInit } from "./commands/init";
import { runRemove } from "./commands/remove";
import { runUpdate } from "./commands/update";
import { CliError, usageError } from "./errors";
import { projectRoot, readCliVersion } from "./paths";
import type { DoctorCheck } from "./types";
import { renderTable } from "./ui";

function printHelp(): void {
  console.log(`portable-hooks — vendor ast-grep rule packs + engine into a project and wire them into AI coding harnesses.

Usage: portable-hooks <command> [options]

Commands:
  init                 Detect harnesses, select packs, vendor rules + engine, wire hooks.
                          --packs <ids|all>  Comma-separated pack ids, or "all". Skips the prompt.
                          -y, --yes          Non-interactive: select all packs, never prompt.
  doctor                Environment + install health checks.
                          --json             Emit a JSON array of checks; exit 1 if any fail.
  audit                 Run the vendored engine's audit over this project.
                          --json             Forwarded to the engine's audit.py.
  add <pack-id>         Vendor one more pack and enable it.
  remove <pack-id>      Un-vendor one pack and disable it.
  update                Re-vendor packs + engine from source; local edits are skipped, not clobbered.

  -h, --help            Show this help.
  --version             Show the installed version.

Exit codes: 0 success, 1 runtime error, 2 usage error.`);
}

function parseArgsOrUsageError(config: Parameters<typeof parseArgs>[0]): ReturnType<typeof parseArgs> {
  try {
    return parseArgs(config);
  } catch (err) {
    usageError(err instanceof Error ? err.message : String(err));
  }
}

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
  const { values } = parseArgsOrUsageError({
    args: rest,
    options: {
      packs: { type: "string" },
      yes: { type: "boolean", short: "y" },
    },
    allowPositionals: false,
    strict: true,
  });
  const outcome = await runInit(projectRoot(), { packsFlag: values.packs as string | undefined, yes: Boolean(values.yes) });
  console.log(outcome.lines.join("\n"));
}

function handleDoctor(rest: string[]): void {
  const { values } = parseArgsOrUsageError({
    args: rest,
    options: { json: { type: "boolean" } },
    allowPositionals: false,
    strict: true,
  });
  const checks = runDoctor(projectRoot());
  printDoctor(checks, Boolean(values.json));
  process.exitCode = checks.some((c) => c.status === "fail") ? 1 : 0;
}

function handleAudit(rest: string[]): void {
  const { values } = parseArgsOrUsageError({
    args: rest,
    options: { json: { type: "boolean" } },
    allowPositionals: false,
    strict: true,
  });
  runAudit(projectRoot(), Boolean(values.json)); // never returns: calls process.exit itself
}

function handleAdd(rest: string[]): void {
  const { positionals } = parseArgsOrUsageError({ args: rest, options: {}, allowPositionals: true, strict: true });
  const packId = positionals[0];
  if (!packId) usageError("`add` requires a pack id, e.g. `portable-hooks add kotlin-best-practices`.");
  const outcome = runAdd(projectRoot(), packId);
  console.log(outcome.lines.join("\n"));
}

function handleRemove(rest: string[]): void {
  const { positionals } = parseArgsOrUsageError({ args: rest, options: {}, allowPositionals: true, strict: true });
  const packId = positionals[0];
  if (!packId) usageError("`remove` requires a pack id, e.g. `portable-hooks remove kotlin-best-practices`.");
  const outcome = runRemove(projectRoot(), packId);
  console.log(outcome.lines.join("\n"));
}

function handleUpdate(rest: string[]): void {
  parseArgsOrUsageError({ args: rest, options: {}, allowPositionals: false, strict: true });
  const outcome = runUpdate(projectRoot());
  console.log(outcome.lines.join("\n"));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    process.exitCode = 2;
    return;
  }
  if (argv[0] === "-h" || argv[0] === "--help") {
    printHelp();
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(readCliVersion());
    return;
  }

  const [command, ...rest] = argv;
  switch (command) {
    case "init":
      return handleInit(rest);
    case "doctor":
      return handleDoctor(rest);
    case "audit":
      return handleAudit(rest); // calls process.exit itself
    case "add":
      return handleAdd(rest);
    case "remove":
      return handleRemove(rest);
    case "update":
      return handleUpdate(rest);
    default:
      console.error(`portable-hooks: unknown command "${command}"\n`);
      printHelp();
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
