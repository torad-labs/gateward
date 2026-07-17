/** TTY detection, the interactive pack multiselect, and plain-text table
 * rendering. No color/animation libraries and no node:readline: decoration
 * is ANSI cursor-motion only, and key input is decoded from raw stdin bytes
 * by the narrow parser below (house rule: narrow inputs get narrow,
 * auditable parsers). Only ever active once {@link isInteractive} is true. */

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export interface SelectableItem {
  id: string;
  label: string;
}

type Key = "up" | "down" | "space" | "toggle-all" | "confirm" | "interrupt";

const SINGLE_BYTE_KEYS: ReadonlyMap<number, Key> = new Map([
  [0x20, "space"],
  [0x61, "toggle-all"], // "a"
  [0x0d, "confirm"], // CR
  [0x0a, "confirm"], // LF
  [0x03, "interrupt"], // ctrl-c
]);

const ARROW_KEYS: ReadonlyMap<number, Key> = new Map([
  [0x41, "up"], // ESC [ A
  [0x42, "down"], // ESC [ B
]);

/** Decodes the keys the multiselect uses from one raw-mode stdin chunk.
 * Arrow keys arrive as the escape sequences `ESC [ A` (up) / `ESC [ B`
 * (down); everything else the prompt reacts to is a single byte. Unknown
 * bytes are ignored — this is a five-key prompt, not a terminal emulator. */
function decodeKeys(chunk: Uint8Array): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < chunk.length; i++) {
    const byte = chunk[i];
    if (byte === undefined) break;
    if (byte === 0x1b && chunk[i + 1] === 0x5b) {
      const arrow = ARROW_KEYS.get(chunk[i + 2] ?? -1);
      if (arrow) keys.push(arrow);
      i += 2;
      continue;
    }
    const key = SINGLE_BYTE_KEYS.get(byte);
    if (key) keys.push(key);
  }
  return keys;
}

/** The multiselect's mutable state, transitioned by {@link applyKey}. */
interface SelectState {
  cursor: number;
  readonly selected: Set<number>;
  readonly count: number;
}

type KeyOutcome = "changed" | "confirm" | "cancel";

/** Applies one key to the selection state; pure with respect to the
 * terminal (rendering is the caller's concern). */
function applyKey(state: SelectState, key: Key): KeyOutcome {
  switch (key) {
    case "interrupt":
      return "cancel";
    case "confirm":
      return "confirm";
    case "up":
      state.cursor = (state.cursor - 1 + state.count) % state.count;
      return "changed";
    case "down":
      state.cursor = (state.cursor + 1) % state.count;
      return "changed";
    case "space":
      if (state.selected.has(state.cursor)) state.selected.delete(state.cursor);
      else state.selected.add(state.cursor);
      return "changed";
    case "toggle-all":
      if (state.selected.size === state.count) state.selected.clear();
      else for (let i = 0; i < state.count; i++) state.selected.add(i);
      return "changed";
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

/** Redraws the whole prompt in place (cursor-up + line-clear ANSI motion). */
function renderSelect(items: readonly SelectableItem[], state: SelectState, message: string, redraw: boolean): void {
  const { stdout } = process;
  if (redraw) stdout.write(`\x1b[${items.length + 2}A`);
  stdout.write(`\x1b[2K${message}\n`);
  for (const [i, item] of items.entries()) {
    const box = state.selected.has(i) ? "[x]" : "[ ]";
    const pointer = i === state.cursor ? "> " : "  ";
    stdout.write(`\x1b[2K${pointer}${box} ${item.id} — ${item.label}\n`);
  }
  stdout.write("\x1b[2K  (up/down move, space toggle, a all/none, enter confirm)\n");
}

/** Arrow keys move the cursor, space toggles the current item, "a" toggles
 * all/none, enter confirms. Defaults to everything selected (the fast path
 * matches `-y`/`--packs all`; a user deselects what they don't want). */
export function promptMultiselect(items: readonly SelectableItem[], message: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const { stdin } = process;
    const canRaw = typeof stdin.setRawMode === "function";

    if (canRaw) stdin.setRawMode(true);
    stdin.resume();

    const state: SelectState = { cursor: 0, selected: new Set(items.keys()), count: items.length };
    let rendered = false;

    const draw = () => {
      renderSelect(items, state, message, rendered);
      rendered = true;
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (canRaw) stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: Uint8Array) => {
      for (const key of decodeKeys(chunk)) {
        const outcome = applyKey(state, key);
        if (outcome === "cancel") {
          cleanup();
          reject(new Error("cancelled"));
          return;
        }
        if (outcome === "confirm") {
          cleanup();
          resolve(items.filter((_, i) => state.selected.has(i)).map((item) => item.id));
          return;
        }
        draw();
      }
    };

    draw();
    stdin.on("data", onData);
  });
}

/** Aligns columns with two-space gutters; no external table library. */
export function renderTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
