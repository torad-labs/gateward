/**
 * Hand-rolled argv flag parsing — zero dependencies, in keeping with the
 * house rule that narrow, known input shapes get narrow, auditable parsers
 * (see domain/packs.ts for pack.yml and domain/tenetsConfig.ts for TOML).
 * Supports exactly what this CLI's commands use: `--flag value`,
 * `--flag=value`, boolean long flags, single-letter short aliases, and a
 * `--` separator; unknown flags and unexpected positionals are usage errors.
 */
import { usageError } from "./errors";

interface FlagSpec {
  type: "string" | "boolean";
  short?: string;
}

interface ParseSpec {
  flags?: Record<string, FlagSpec>;
  allowPositionals?: boolean;
}

interface ParsedFlags {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

/** A dashed token, resolved to its long flag name plus any `=value`. */
interface FlagToken {
  name: string;
  inlineValue?: string;
}

function resolveFlagToken(arg: string, shortToLong: ReadonlyMap<string, string>): FlagToken {
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    if (eq === -1) return { name: arg.slice(2) };
    return { name: arg.slice(2, eq), inlineValue: arg.slice(eq + 1) };
  }
  const long = shortToLong.get(arg.slice(1));
  if (!long) usageError(`Unknown option '${arg}'.`);
  return { name: long };
}

/** Applies one resolved flag; returns how many extra args it consumed (0 or 1). */
function applyFlag(token: FlagToken, flag: FlagSpec, next: string | undefined, values: ParsedFlags["values"]): number {
  if (flag.type === "boolean") {
    if (token.inlineValue !== undefined) usageError(`Option '--${token.name}' does not take a value.`);
    values[token.name] = true;
    return 0;
  }
  if (token.inlineValue !== undefined) {
    values[token.name] = token.inlineValue;
    return 0;
  }
  if (next === undefined) usageError(`Option '--${token.name}' requires a value.`);
  values[token.name] = next;
  return 1;
}

export function parseFlags(args: string[], spec: ParseSpec = {}): ParsedFlags {
  const flags = spec.flags ?? {};
  const shortToLong = new Map(
    Object.entries(flags).flatMap(([name, flag]) => (flag.short ? [[flag.short, name] as const] : [])),
  );

  const values: ParsedFlags["values"] = {};
  const positionals: string[] = [];
  let onlyPositionals = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (onlyPositionals || arg === "-" || !arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      onlyPositionals = true;
      continue;
    }

    const token = resolveFlagToken(arg, shortToLong);
    const flag = flags[token.name];
    if (!flag) usageError(`Unknown option '--${token.name}'.`);
    i += applyFlag(token, flag, args[i + 1], values);
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
