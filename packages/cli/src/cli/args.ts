/**
 * Hand-rolled argv flag parsing — zero dependencies, in keeping with the
 * house rule that narrow, known input shapes get narrow, auditable parsers
 * (see domain/packs.ts for pack.yml and domain/tenetsConfig.ts for TOML).
 * Supports exactly what this CLI's commands use: `--flag value`,
 * `--flag=value`, boolean long flags, single-letter short aliases, and a
 * `--` separator; unknown flags and unexpected positionals are usage errors.
 */
import { usageError } from "./errors";

export interface FlagSpec {
  type: "string" | "boolean";
  short?: string;
}

export interface ParseSpec {
  flags?: Record<string, FlagSpec>;
  allowPositionals?: boolean;
}

export interface ParsedFlags {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

export function parseFlags(args: string[], spec: ParseSpec = {}): ParsedFlags {
  const flags = spec.flags ?? {};
  const shortToLong = new Map<string, string>();
  for (const [name, flag] of Object.entries(flags)) {
    if (flag.short) shortToLong.set(flag.short, name);
  }

  const values: ParsedFlags["values"] = {};
  const positionals: string[] = [];
  let onlyPositionals = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (onlyPositionals || arg === "-" || !arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      onlyPositionals = true;
      continue;
    }

    let name: string;
    let inlineValue: string | undefined;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) inlineValue = arg.slice(eq + 1);
    } else {
      const long = shortToLong.get(arg.slice(1));
      if (!long) usageError(`Unknown option '${arg}'.`);
      name = long;
    }

    const flag = flags[name];
    if (!flag) usageError(`Unknown option '--${name}'.`);
    if (flag.type === "boolean") {
      if (inlineValue !== undefined) usageError(`Option '--${name}' does not take a value.`);
      values[name] = true;
      continue;
    }
    if (inlineValue !== undefined) {
      values[name] = inlineValue;
      continue;
    }
    const next = args[i + 1];
    if (next === undefined) usageError(`Option '--${name}' requires a value.`);
    values[name] = next;
    i++;
  }

  if (!spec.allowPositionals && positionals.length > 0) {
    usageError(`Unexpected argument '${positionals[0]}'.`);
  }
  return { values, positionals };
}

export const HELP_TEXT = `portable-hooks — vendor ast-grep rule packs + engine into a project and wire them into AI coding harnesses.

Usage: portable-hooks <command> [options]

Commands:
  init                 Detect harnesses, select packs, vendor rules + engine, wire hooks.
                          --packs <ids|all>  Comma-separated pack ids, or "all". Skips the prompt.
                          -y, --yes          Non-interactive: select all packs, never prompt.
  doctor                Environment + install health checks.
                          --json             Emit a JSON array of checks; exit 1 if any fail.
  audit                 Run the vendored engine's audit over this project.
                          --json             Forwarded to the engine's audit.
  add <pack-id>         Vendor one more pack and enable it.
  remove <pack-id>      Un-vendor one pack and disable it.
  update                Re-vendor packs + engine from source; local edits are skipped, not clobbered.

  -h, --help            Show this help.
  --version             Show the installed version.

Exit codes: 0 success, 1 runtime error, 2 usage error.`;
