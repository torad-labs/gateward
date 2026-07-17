/**
 * A narrow, purpose-built reader for `pack.yml` — NOT a general YAML parser.
 *
 * Mirrors the discipline in packages/core/src/config.ts's `packRuleDefaultsFrom`:
 * pack.yml is a small, self-authored manifest (flat top-level scalars plus one
 * `rules:` list of `- id: ...` entries with scalar keys), so a line-oriented
 * scan is enough. The one wrinkle is that `summary:` (and `description:`) may
 * be a folded block scalar (`>-`) spanning several more-indented lines, which
 * this module folds into a single space-joined string, per YAML folding rules.
 */
import * as path from "node:path";
import type { PackMeta, RuleMeta } from "../types";

/** A line's leading spaces/tabs. */
const LEADING_WHITESPACE_RE = /^[ \t]*/;
/** Splits pack.yml text into lines, tolerating CRLF line endings. */
const PACK_YAML_LINE_SPLIT_RE = /\r?\n/;

function leadingWhitespace(line: string): string {
  return LEADING_WHITESPACE_RE.exec(line)?.[0] ?? "";
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function parseScalarValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const [first] = trimmed;
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

const BLOCK_SCALAR_MARKERS = new Set([">-", ">", "|-", "|", ""]);

/** A block scalar's continuation lines: every line indented deeper than
 * `minIndent` (blank lines skipped), collected stripped-and-trimmed.
 * Returns the collected parts and the index of the first line past the block. */
function scanBlockScalar(lines: readonly string[], start: number, minIndent: number): { parts: string[]; end: number } {
  const parts: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const cont = lines[i];
    if (cont === undefined || cont.trim() === "") continue;
    if (leadingWhitespace(cont).length <= minIndent) break;
    parts.push(stripComment(cont).trim());
  }
  return { parts, end: i };
}

interface HeaderScan {
  id: string | null;
  title: string | null;
  language: string | null;
  /** Index of the first line after `rules:` (or past the document). */
  rulesStart: number;
}

/** Position within the line-oriented scan: the full line array plus the
 * current index, bundled so the per-line appliers below stay at 4 params. */
interface LineCursor {
  lines: readonly string[];
  i: number;
}

/** Applies one top-level `key: value` header line: assigns id/title/language,
 * or — for an unrecognized block-scalar value (e.g. `description: >-`) —
 * skips its continuation lines wholesale. Returns the loop index to resume
 * from when this line opened a skipped block scalar, or null otherwise. */
function applyHeaderField(header: HeaderScan, key: string, rawValue: string, cursor: LineCursor): number | null {
  if (key === "id") header.id = parseScalarValue(rawValue);
  else if (key === "title") header.title = parseScalarValue(rawValue);
  else if (key === "language") header.language = parseScalarValue(rawValue);
  else if (BLOCK_SCALAR_MARKERS.has(rawValue)) return scanBlockScalar(cursor.lines, cursor.i + 1, 0).end - 1;
  return null;
}

/** Phase 1: top-level scalars, until `rules:`. */
function scanHeader(lines: readonly string[]): HeaderScan {
  const header: HeaderScan = { id: null, title: null, language: null, rulesStart: lines.length };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined || raw.trim() === "") continue;
    if (leadingWhitespace(raw).length > 0) continue; // stray indented line outside any tracked block
    const stripped = stripComment(raw).trim();
    if (stripped === "") continue;
    if (stripped === "rules:") {
      header.rulesStart = i + 1;
      break;
    }
    const colonIdx = stripped.indexOf(":");
    if (colonIdx === -1) continue;
    const key = stripped.slice(0, colonIdx).trim();
    const rawValue = stripped.slice(colonIdx + 1).trim();
    const skipTo = applyHeaderField(header, key, rawValue, { lines, i });
    if (skipTo !== null) i = skipTo;
  }
  return header;
}

interface RuleDraft {
  id: string;
  tier: string;
  defaultEnabled: boolean;
  summary?: string;
}

/** Applies one indented rule-body line (`tier:`/`default_enabled:`/
 * `summary:`) to the rule draft in progress. `summary:` may be a folded
 * block scalar spanning further-indented lines. Returns the loop index to
 * resume from when a block scalar was consumed, or null otherwise. */
function applyRuleField(current: RuleDraft, stripped: string, cursor: LineCursor, indent: number): number | null {
  if (stripped.startsWith("tier:")) {
    current.tier = parseScalarValue(stripped.slice("tier:".length));
  } else if (stripped.startsWith("default_enabled:")) {
    current.defaultEnabled = parseScalarValue(stripped.slice("default_enabled:".length)).toLowerCase() === "true";
  } else if (stripped.startsWith("summary:")) {
    const valuePart = stripped.slice("summary:".length).trim();
    if (BLOCK_SCALAR_MARKERS.has(valuePart) && valuePart !== "") {
      const block = scanBlockScalar(cursor.lines, cursor.i + 1, indent);
      current.summary = block.parts.join(" ").trim();
      return block.end - 1;
    }
    current.summary = parseScalarValue(valuePart);
  }
  return null;
}

/** Phase 2: the `rules:` list — `- id:` entries with scalar keys, where
 * `summary:` may be a folded block spanning further-indented lines. */
function scanRules(lines: readonly string[], start: number): RuleMeta[] {
  const rules: RuleMeta[] = [];
  let current: RuleDraft | null = null;

  const finalizeCurrent = () => {
    if (current) rules.push({ ...current });
  };

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined || raw.trim() === "") continue;
    const indent = leadingWhitespace(raw).length;
    if (indent === 0) break; // dedented past the rules: block
    const stripped = stripComment(raw).trim();
    if (stripped === "") continue;
    if (stripped.startsWith("- id:")) {
      finalizeCurrent();
      current = { id: parseScalarValue(stripped.slice("- id:".length)), tier: "deny", defaultEnabled: true };
      continue;
    }
    if (!current) continue;
    const skipTo = applyRuleField(current, stripped, { lines, i }, indent);
    if (skipTo !== null) i = skipTo;
  }
  finalizeCurrent();
  return rules;
}

/** Parses one `pack.yml` document's text into a {@link PackMeta}. */
export function parsePackYaml(text: string, dir: string): PackMeta {
  const lines = text.split(PACK_YAML_LINE_SPLIT_RE);
  const header = scanHeader(lines);
  const rules = scanRules(lines, header.rulesStart);

  if (!header.id) {
    throw new Error(`pack.yml at ${dir} has no top-level "id:"`);
  }
  if (!header.language) {
    throw new Error(`pack.yml at ${dir} has no top-level "language:"`);
  }
  return { id: header.id, title: header.title ?? header.id, language: header.language, dir, rules };
}

/** The distinct ast-grep languages the given packs target, sorted for a
 * deterministic config.toml. Each pack targets exactly one language. */
export function languagesForPacks(packs: PackMeta[]): string[] {
  return Array.from(new Set(packs.map((p) => p.language))).sort();
}

/** Enumerates every pack under `packsRoot` (each a subdirectory with a pack.yml). */
export async function listPacks(packsRoot: string): Promise<PackMeta[]> {
  const manifests: string[] = [];
  try {
    const glob = new Bun.Glob("*/pack.yml");
    for await (const rel of glob.scan({ cwd: packsRoot, onlyFiles: true })) {
      manifests.push(rel.split(path.sep).join("/"));
    }
  } catch {
    return []; // packsRoot itself is absent
  }
  const packs: PackMeta[] = [];
  for (const rel of manifests.sort()) {
    const dir = path.join(packsRoot, path.dirname(rel));
    // biome-ignore lint/performance/noAwaitInLoops: sequential so `packs` comes out in deterministic sorted-manifest order for config.toml generation
    const text = await Bun.file(path.join(packsRoot, ...rel.split("/"))).text();
    packs.push(parsePackYaml(text, dir));
  }
  return packs;
}
