/**
 * Generates and reads `.tenets/config.toml` — scoped exactly to the schema
 * this CLI itself writes (see packages/core/src/config.ts's module doc for
 * the canonical schema). This is NOT a general TOML parser: it understands
 * `[core]`, `[packs]`, `languages`/`default_tier`/`packs_dir`/`enabled`, and
 * double-quoted string / string-array values only — the same narrow-scan
 * discipline the Python engine itself uses for pack.yml.
 *
 * `[rules.<id>]` tables are intentionally NOT modeled structurally here:
 * `add`/`remove` preserve `[core]` and `packs_dir` verbatim from the existing
 * file, but regenerate the entire rules section from the (possibly changed)
 * enabled-pack set. A hand-edited per-rule `tier`/`enabled` override survives
 * `update` (which never touches config.toml) but would be reset by a later
 * `add`/`remove` of a *different* pack in the same project — a known,
 * documented limitation, not exercised by the pinned test list.
 */
import type { PackMeta } from "../types";

export interface ConfigTomlCore {
  languages: string[];
  defaultTier: string;
}

export interface ConfigTomlPacks {
  packsDir: string;
  enabled: string[];
}

export interface ParsedConfigToml {
  core: ConfigTomlCore;
  packs: ConfigTomlPacks;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

export interface GenerateConfigTomlOptions {
  languages: string[];
  defaultTier: string;
  packsDir: string;
  enabledPacks: PackMeta[];
}

/** Generates `.tenets/config.toml` text for the given enabled-pack set. */
export function generateConfigToml(opts: GenerateConfigTomlOptions): string {
  const lines: string[] = [];
  lines.push("[core]");
  lines.push(`languages = ${tomlStringArray(opts.languages)}`);
  lines.push(`default_tier = ${tomlString(opts.defaultTier)}`);
  lines.push("");
  lines.push("[packs]");
  lines.push(`packs_dir = ${tomlString(opts.packsDir)}`);
  lines.push(`enabled = ${tomlStringArray(opts.enabledPacks.map((p) => p.id))}`);

  for (const pack of opts.enabledPacks) {
    for (const rule of pack.rules) {
      if (!rule.defaultEnabled) {
        lines.push("");
        const context = rule.summary ? ` ${rule.summary}` : "";
        lines.push(`# ${rule.id}: disabled by default in ${pack.id}.${context} Uncomment to enable:`);
        lines.push(`# [rules.${rule.id}]`);
        if (rule.tier !== opts.defaultTier) lines.push(`# tier = ${tomlString(rule.tier)}`);
        lines.push(`# enabled = true`);
      } else if (rule.tier !== opts.defaultTier) {
        lines.push("");
        lines.push(`[rules.${rule.id}]`);
        lines.push(`tier = ${tomlString(rule.tier)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function stripTomlComment(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "#" && !inQuotes) return line.slice(0, i);
  }
  return line;
}

function parseTomlString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function parseTomlStringArray(value: string): string[] {
  const matches = value.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  return matches.map((m) => parseTomlString(m));
}

/** Reads just the fields this CLI needs back out of an existing config.toml. */
export function parseConfigToml(text: string): ParsedConfigToml {
  const core: ConfigTomlCore = { languages: [], defaultTier: "deny" };
  const packs: ConfigTomlPacks = { packsDir: "packs", enabled: [] };
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim();
    if (line === "") continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (section === "core") {
      if (key === "languages") core.languages = parseTomlStringArray(value);
      else if (key === "default_tier") core.defaultTier = parseTomlString(value);
    } else if (section === "packs") {
      if (key === "packs_dir") packs.packsDir = parseTomlString(value);
      else if (key === "enabled") packs.enabled = parseTomlStringArray(value);
    }
  }
  return { core, packs };
}

/** Doctor's "structural check": literal `[core]` and `[packs]` section headers present. */
export function hasCoreAndPacksSections(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => stripTomlComment(l).trim());
  return lines.includes("[core]") && lines.includes("[packs]");
}
