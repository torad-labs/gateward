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

/** Decodes the keys the multiselect uses from one raw-mode stdin chunk.
 * Arrow keys arrive as the escape sequences `ESC [ A` (up) / `ESC [ B`
 * (down); everything else the prompt reacts to is a single byte. Unknown
 * bytes are ignored — this is a five-key prompt, not a terminal emulator. */
function decodeKeys(chunk: Uint8Array): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < chunk.length; i++) {
    const byte = chunk[i];
    if (byte === 0x1b && chunk[i + 1] === 0x5b) {
      if (chunk[i + 2] === 0x41) keys.push("up");
      if (chunk[i + 2] === 0x42) keys.push("down");
      i += 2;
      continue;
    }
    if (byte === 0x20) keys.push("space");
    else if (byte === 0x61)
      keys.push("toggle-all"); // "a"
    else if (byte === 0x0d || byte === 0x0a) keys.push("confirm");
    else if (byte === 0x03) keys.push("interrupt"); // ctrl-c
  }
  return keys;
}

/** Arrow keys move the cursor, space toggles the current item, "a" toggles
 * all/none, enter confirms. Defaults to everything selected (the fast path
 * matches `-y`/`--packs all`; a user deselects what they don't want). */
export function promptMultiselect(items: SelectableItem[], message: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const canRaw = typeof stdin.setRawMode === "function";

    if (canRaw) stdin.setRawMode(true);
    stdin.resume();

    let cursor = 0;
    const selected = new Set<number>(items.map((_, i) => i));
    let rendered = false;

    const render = () => {
      if (rendered) stdout.write(`\x1b[${items.length + 2}A`);
      rendered = true;
      stdout.write(`\x1b[2K${message}\n`);
      for (const [i, item] of items.entries()) {
        const box = selected.has(i) ? "[x]" : "[ ]";
        const pointer = i === cursor ? "> " : "  ";
        stdout.write(`\x1b[2K${pointer}${box} ${item.id} — ${item.label}\n`);
      }
      stdout.write("\x1b[2K  (up/down move, space toggle, a all/none, enter confirm)\n");
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (canRaw) stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: Uint8Array) => {
      for (const key of decodeKeys(chunk)) {
        switch (key) {
          case "interrupt":
            cleanup();
            reject(new Error("cancelled"));
            return;
          case "up":
            cursor = (cursor - 1 + items.length) % items.length;
            render();
            break;
          case "down":
            cursor = (cursor + 1) % items.length;
            render();
            break;
          case "space":
            if (selected.has(cursor)) selected.delete(cursor);
            else selected.add(cursor);
            render();
            break;
          case "toggle-all":
            if (selected.size === items.length) selected.clear();
            else for (let i = 0; i < items.length; i++) selected.add(i);
            render();
            break;
          case "confirm":
            cleanup();
            resolve(items.filter((_, i) => selected.has(i)).map((item) => item.id));
            return;
        }
      }
    };

    render();
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
        .map((cell, i) => cell.padEnd(widths[i]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
