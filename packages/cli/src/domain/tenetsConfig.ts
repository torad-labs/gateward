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
import type { PackMeta, RuleMeta } from "../types";

/** Matches a `[section]` header line (after comment-stripping and trimming). */
const CONFIG_SECTION_HEADER_RE = /^\[([^\]]+)\]$/;
/** Splits config.toml text into lines, tolerating CRLF line endings. */
const CONFIG_LINE_SPLIT_RE = /\r?\n/;

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

/** The only shape a pack id or rule id may take — mirrors packs.ts's
 * SAFE_ID_RE. Enforced there at parse time already, but emitRuleSection
 * interpolates raw ids into `[rules.<id>]` headers/comments without
 * escaping (only the tier value is escaped), so this is defense in depth:
 * if that upstream guarantee were ever weakened, config.toml generation
 * itself still refuses to interpolate an unsafe id. */
const SAFE_ID_RE = /^[a-z][a-z0-9-]*$/;

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

/** Emits one rule's TOML block: a commented, default-off template (with an
 * explanatory line naming the owning pack and its pack.yml summary) when the
 * rule itself is off by default, or a live `[rules.<id>]` override when it's
 * enabled but its tier differs from the project default. Rules that are both
 * enabled and at the default tier need no block at all. */
function emitRuleSection(lines: string[], pack: PackMeta, rule: RuleMeta, defaultTier: string): void {
  if (!(SAFE_ID_RE.test(rule.id) && SAFE_ID_RE.test(pack.id))) {
    throw new Error(
      `refusing to emit config.toml section for unsafe id (pack "${pack.id}", rule "${rule.id}"): must match ${SAFE_ID_RE}.`,
    );
  }
  if (!rule.defaultEnabled) {
    lines.push("");
    const context = rule.summary ? ` ${rule.summary}` : "";
    lines.push(`# ${rule.id}: disabled by default in ${pack.id}.${context} Uncomment to enable:`);
    lines.push(`# [rules.${rule.id}]`);
    if (rule.tier !== defaultTier) lines.push(`# tier = ${tomlString(rule.tier)}`);
    lines.push("# enabled = true");
  } else if (rule.tier !== defaultTier) {
    lines.push("");
    lines.push(`[rules.${rule.id}]`);
    lines.push(`tier = ${tomlString(rule.tier)}`);
  }
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
      emitRuleSection(lines, pack, rule, opts.defaultTier);
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
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed.at(-1) === '"') {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function parseTomlStringArray(value: string): string[] {
  const matches = value.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  return matches.map((m) => parseTomlString(m));
}

/** Applies one non-blank, non-header config.toml line — a `key = value` pair
 * already split apart, under the given `[section]` — onto the in-progress
 * parse result. Unknown sections/keys (anything but `[core]`'s `languages`/
 * `default_tier` and `[packs]`'s `packs_dir`/`enabled`) are silently ignored,
 * matching this module's narrow, non-general-purpose TOML scan. */
function applyConfigLine(section: string, key: string, value: string, out: ParsedConfigToml): void {
  if (section === "core") {
    if (key === "languages") out.core.languages = parseTomlStringArray(value);
    else if (key === "default_tier") out.core.defaultTier = parseTomlString(value);
  } else if (section === "packs") {
    if (key === "packs_dir") out.packs.packsDir = parseTomlString(value);
    else if (key === "enabled") out.packs.enabled = parseTomlStringArray(value);
  }
}

/** Reads just the fields this CLI needs back out of an existing config.toml. */
export function parseConfigToml(text: string): ParsedConfigToml {
  const out: ParsedConfigToml = {
    core: { languages: [], defaultTier: "deny" },
    packs: { packsDir: "packs", enabled: [] },
  };
  let section = "";
  for (const raw of text.split(CONFIG_LINE_SPLIT_RE)) {
    const line = stripTomlComment(raw).trim();
    if (line === "") continue;
    const sectionMatch = CONFIG_SECTION_HEADER_RE.exec(line);
    if (sectionMatch) {
      const [, captured] = sectionMatch;
      if (captured === undefined) continue;
      section = captured.trim();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    applyConfigLine(section, key, value, out);
  }
  return out;
}

/** Doctor's "structural check": literal `[core]` and `[packs]` section headers present. */
export function hasCoreAndPacksSections(text: string): boolean {
  const lines = text.split(CONFIG_LINE_SPLIT_RE).map((l) => stripTomlComment(l).trim());
  return lines.includes("[core]") && lines.includes("[packs]");
}
