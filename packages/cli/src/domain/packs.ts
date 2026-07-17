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

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
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
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

const BLOCK_SCALAR_MARKERS = new Set([">-", ">", "|-", "|", ""]);

/** Parses one `pack.yml` document's text into a {@link PackMeta}. */
export function parsePackYaml(text: string, dir: string): PackMeta {
  const lines = text.split(/\r?\n/);
  const n = lines.length;
  let i = 0;
  let id: string | null = null;
  let title: string | null = null;
  let language: string | null = null;

  // Phase 1: top-level scalars, until `rules:`.
  while (i < n) {
    const raw = lines[i];
    if (raw.trim() === "") {
      i++;
      continue;
    }
    if (leadingWhitespace(raw).length > 0) {
      i++; // stray indented line outside any block we're tracking; ignore
      continue;
    }
    const stripped = stripComment(raw).trim();
    if (stripped === "") {
      i++;
      continue;
    }
    if (stripped === "rules:") {
      i++;
      break;
    }
    const colonIdx = stripped.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = stripped.slice(0, colonIdx).trim();
    const rawValue = stripped.slice(colonIdx + 1).trim();
    if (key === "id") {
      id = parseScalarValue(rawValue);
      i++;
      continue;
    }
    if (key === "title") {
      title = parseScalarValue(rawValue);
      i++;
      continue;
    }
    if (key === "language") {
      language = parseScalarValue(rawValue);
      i++;
      continue;
    }
    if (BLOCK_SCALAR_MARKERS.has(rawValue)) {
      // A top-level block scalar we don't need (e.g. description: >-).
      // Skip every more-indented continuation line.
      i++;
      while (i < n) {
        const cont = lines[i];
        if (cont.trim() === "") {
          i++;
          continue;
        }
        if (leadingWhitespace(cont).length <= 0) break;
        i++;
      }
      continue;
    }
    i++;
  }

  // Phase 2: the `rules:` list.
  const rules: RuleMeta[] = [];
  let current: { id: string; tier: string; defaultEnabled: boolean; summary?: string } | null = null;

  const finalizeCurrent = () => {
    if (current) rules.push({ ...current });
  };

  while (i < n) {
    const raw = lines[i];
    if (raw.trim() === "") {
      i++;
      continue;
    }
    const indent = leadingWhitespace(raw).length;
    if (indent === 0) break; // dedented past the rules: block
    const stripped = stripComment(raw).trim();
    if (stripped === "") {
      i++;
      continue;
    }
    if (stripped.startsWith("- id:")) {
      finalizeCurrent();
      current = { id: parseScalarValue(stripped.slice("- id:".length)), tier: "deny", defaultEnabled: true };
      i++;
      continue;
    }
    if (!current) {
      i++;
      continue;
    }
    if (stripped.startsWith("tier:")) {
      current.tier = parseScalarValue(stripped.slice("tier:".length));
      i++;
      continue;
    }
    if (stripped.startsWith("default_enabled:")) {
      current.defaultEnabled = parseScalarValue(stripped.slice("default_enabled:".length)).toLowerCase() === "true";
      i++;
      continue;
    }
    if (stripped.startsWith("summary:")) {
      const valuePart = stripped.slice("summary:".length).trim();
      if (BLOCK_SCALAR_MARKERS.has(valuePart) && valuePart !== "") {
        const summaryIndent = indent;
        const collected: string[] = [];
        i++;
        while (i < n) {
          const cont = lines[i];
          if (cont.trim() === "") {
            i++;
            continue;
          }
          if (leadingWhitespace(cont).length <= summaryIndent) break;
          collected.push(stripComment(cont).trim());
          i++;
        }
        current.summary = collected.join(" ").trim();
        continue;
      }
      current.summary = parseScalarValue(valuePart);
      i++;
      continue;
    }
    i++;
  }
  finalizeCurrent();

  if (!id) {
    throw new Error(`pack.yml at ${dir} has no top-level "id:"`);
  }
  if (!language) {
    throw new Error(`pack.yml at ${dir} has no top-level "language:"`);
  }
  return { id, title: title ?? id, language, dir, rules };
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
    const text = await Bun.file(path.join(packsRoot, ...rel.split("/"))).text();
    packs.push(parsePackYaml(text, dir));
  }
  return packs;
}
