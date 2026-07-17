#!/usr/bin/env bun
/**
 * backlog.ts — the one channel for a feature backlog (the "ledger" in
 * declare-then-earn). A Bun port of the fleet's Python manifest CLI.
 *
 * The backlog is a checked-in TOML file: the memory that survives a dead
 * agent context. Every item carries its own decisions and resume pointers as
 * dated `#` note lines, so a session killed mid-task is resumable from the
 * file alone. This CLI is the ONLY writer, which buys three things the fleet
 * learned the hard way:
 *   - `get <ID>` returns ~10 lines, not a whole-file read (token cost is the
 *     orchestrator's scarcest resource);
 *   - writes are atomic under an exclusive lock (concurrent agents collide);
 *   - notes are appended line-by-line, never round-tripped through a
 *     serializer that would strip the comments the decisions live in.
 *
 * Zero dependencies: the TOML we emit is the narrow shape we parse, same
 * discipline as the gate engine's pack.yml / config.toml readers. Reads in the
 * locked critical section are synchronous Buffer reads by design (the lock must
 * be held start-to-finish); async Bun.file().text() would open a write window.
 *
 * Status ladder (declare-then-earn): todo -> in_flight -> done -> verified.
 * "done" is the agent's claim; "verified" is earned by proof. Open work =
 * todo | in_flight; the stop hook blocks a stop while any item is open.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const STATUSES = ["todo", "in_flight", "done", "verified"] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN_STATUSES: Status[] = ["todo", "in_flight"];

export interface Item {
  id: string;
  title: string;
  status: Status;
  files: string[];
  verify: string;
  notes: string[]; // dated `#` lines, in order
}

const DEFAULT_HEADER =
  "# Feature backlog. This CLI is the only writer.\n" +
  "# Open items (todo|in_flight) block a stop — you cannot declare done with work left.\n" +
  "# Notes are dated lines carrying decisions + resume pointers: an agent killed\n" +
  "# mid-task is resumable from this file alone.\n";

// ----------------------------------------------------------------- parsing --

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseTomlString(raw: string): string {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseStringArray(raw: string): string[] {
  const matches = raw.match(/"(?:[^"\\]|\\.)*"/g);
  return matches ? matches.map(parseTomlString) : [];
}

/** Parse the narrow backlog TOML into items. Notes are the `#` lines that
 *  follow an item's keys, preserved verbatim and in order. */
export function parseBacklog(text: string): Item[] {
  const items: Item[] = [];
  let current: Item | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "[[items]]") {
      current = { id: "", title: "", status: "todo", files: [], verify: "", notes: [] };
      items.push(current);
      continue;
    }
    if (!current) continue; // header comments, before the first item
    if (trimmed.startsWith("#")) {
      current.notes.push(trimmed.replace(/^#\s?/, ""));
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "id") current.id = parseTomlString(value);
    else if (key === "title") current.title = parseTomlString(value);
    else if (key === "status") current.status = parseTomlString(value) as Status;
    else if (key === "verify") current.verify = parseTomlString(value);
    else if (key === "files") current.files = parseStringArray(value);
  }
  return items;
}

export function serializeBacklog(items: Item[], header = DEFAULT_HEADER): string {
  const blocks = items.map((item) => {
    const lines = [
      "[[items]]",
      `id = ${tomlString(item.id)}`,
      `title = ${tomlString(item.title)}`,
      `status = ${tomlString(item.status)}`,
      `files = [${item.files.map(tomlString).join(", ")}]`,
      `verify = ${tomlString(item.verify)}`,
      ...item.notes.map((note) => `# ${note}`),
    ];
    return lines.join("\n");
  });
  return `${header}\n${blocks.join("\n\n")}\n`;
}

export function openItems(items: Item[]): Item[] {
  return items.filter((item) => OPEN_STATUSES.includes(item.status));
}

// -------------------------------------------------------------- read/write --

/** Read whole-file text synchronously via a Buffer (the gate exempts Buffer
 *  reads; text-encoded fs.readFileSync is blocked in favor of Bun.file). */
function readTextSync(file: string): string {
  return fs.readFileSync(file).toString("utf8");
}

export function findBacklog(startDir = process.cwd()): string | null {
  if (process.env.BACKLOG_PATH) return process.env.BACKLOG_PATH;
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ".tenets", "backlog.toml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readBacklog(file: string): Item[] {
  return parseBacklog(readTextSync(file));
}

/** Atomic, exclusive-locked read-modify-write. The lock is an O_EXCL lockfile
 *  (same guarantee as flock for our single-host case); the write is temp +
 *  rename so a crash never leaves a half-written ledger. */
export function mutateBacklog(file: string, fn: (items: Item[]) => Item[]): Item[] {
  const lock = `${file}.lock`;
  let fd: number | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      fd = fs.openSync(lock, "wx");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 50) throw error;
      Bun.sleepSync(20);
    }
  }
  try {
    const items = fn(parseBacklog(readTextSync(file)));
    const text = serializeBacklog(items);
    parseBacklog(text); // re-parse guard: never write something we can't read back
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return items;
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// --------------------------------------------------------------------- CLI --

function requireItem(items: Item[], id: string): Item {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    console.error(`no item with id ${id}`);
    process.exit(1);
  }
  return item;
}

function renderItem(item: Item): string {
  const head = `${item.id}  [${item.status}]  ${item.title}`;
  const files = item.files.length ? `\n  files: ${item.files.join(", ")}` : "";
  const verify = item.verify ? `\n  verify: ${item.verify}` : "";
  const notes = item.notes.length ? `\n  notes:\n${item.notes.map((n) => `    - ${n}`).join("\n")}` : "";
  return head + files + verify + notes;
}

const USAGE = `backlog — the one channel for the feature ledger

  backlog list [--status <s>]        compact table (optionally filtered)
  backlog get <id>                   one item, notes and all (~10 lines)
  backlog next                       the next open item (todo|in_flight)
  backlog add --id <id> --title <t> [--files a,b] [--verify <t>]
  backlog set-status <id> <status>   status in: ${STATUSES.join(" | ")}
  backlog note <id> "<text>"         append a dated note (decisions live here)
  backlog selftest                   parse/serialize round-trip check
`;

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1] ?? "";
      i++;
    }
  }
  return flags;
}

export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  if (command === "selftest") {
    const sample: Item[] = [
      { id: "T1", title: "one", status: "todo", files: ["a.kt"], verify: "tests", notes: ["decided x"] },
      { id: "T2", title: "two", status: "verified", files: [], verify: "", notes: [] },
    ];
    const round = parseBacklog(serializeBacklog(sample));
    const ok = JSON.stringify(round) === JSON.stringify(sample);
    console.log(ok ? "selftest: ok" : "selftest: FAILED");
    return ok ? 0 : 1;
  }

  const file = findBacklog();
  if (!file) {
    console.error("no .tenets/backlog.toml found (set BACKLOG_PATH to override)");
    return 1;
  }

  switch (command) {
    case "list": {
      const flags = parseFlags(rest);
      let items = readBacklog(file);
      if (flags.status) items = items.filter((item) => item.status === flags.status);
      for (const item of items) console.log(`${item.id}  [${item.status}]  ${item.title}`);
      return 0;
    }
    case "get": {
      console.log(renderItem(requireItem(readBacklog(file), rest[0])));
      return 0;
    }
    case "next": {
      const open = openItems(readBacklog(file));
      if (open.length === 0) {
        console.log("(no open items)");
        return 0;
      }
      console.log(renderItem(open[0]));
      return 0;
    }
    case "add": {
      const flags = parseFlags(rest);
      if (!flags.id || !flags.title) {
        console.error("add requires --id and --title");
        return 1;
      }
      mutateBacklog(file, (items) => {
        if (items.some((item) => item.id === flags.id)) {
          console.error(`item ${flags.id} already exists`);
          process.exit(1);
        }
        items.push({
          id: flags.id,
          title: flags.title,
          status: "todo",
          files: flags.files ? flags.files.split(",").map((f) => f.trim()) : [],
          verify: flags.verify ?? "",
          notes: [`${today()} created`],
        });
        return items;
      });
      console.log(`added ${flags.id}`);
      return 0;
    }
    case "set-status": {
      const [id, status] = rest;
      if (!STATUSES.includes(status as Status)) {
        console.error(`status must be one of: ${STATUSES.join(", ")}`);
        return 1;
      }
      mutateBacklog(file, (items) => {
        const item = requireItem(items, id);
        item.notes.push(`${today()} status ${item.status} -> ${status}`);
        item.status = status as Status;
        return items;
      });
      // The nudge rides the write itself (substrate, not instruction): the CLI
      // reminds the agent what's still open at the exact moment it advances one.
      const stillOpen = openItems(readBacklog(file));
      console.log(`${id} -> ${status}`);
      if (stillOpen.length) {
        console.log(`still open: ${stillOpen.map((item) => item.id).join(", ")}`);
      }
      return 0;
    }
    case "note": {
      const [id, ...textParts] = rest;
      const text = textParts.join(" ").replace(/^"|"$/g, "");
      if (!text) {
        console.error('note requires text: backlog note <id> "..."');
        return 1;
      }
      mutateBacklog(file, (items) => {
        requireItem(items, id).notes.push(`${today()} ${text}`);
        return items;
      });
      console.log(`noted on ${id}`);
      return 0;
    }
    default:
      console.error(`unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

if (import.meta.main) {
  process.exit(main(Bun.argv.slice(2)));
}
