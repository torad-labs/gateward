/** TTY detection, the interactive pack multiselect, and plain-text table
 * rendering. No color/animation libraries: decoration is ANSI cursor-motion
 * only, and only ever used once {@link isInteractive} is true. */
import * as readline from "node:readline";

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export interface SelectableItem {
  id: string;
  label: string;
}

interface KeypressKey {
  name?: string;
  ctrl?: boolean;
}

/** Arrow keys move the cursor, space toggles the current item, "a" toggles
 * all/none, enter confirms. Defaults to everything selected (the fast path
 * matches `-y`/`--packs all`; a user deselects what they don't want). */
export function promptMultiselect(items: SelectableItem[], message: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const canRaw = typeof stdin.setRawMode === "function";

    readline.emitKeypressEvents(stdin);
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
      stdin.removeListener("keypress", onKeypress);
      if (canRaw) stdin.setRawMode(false);
      stdin.pause();
    };

    const onKeypress = (_str: string, key: KeypressKey | undefined) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("cancelled"));
        return;
      }
      switch (key.name) {
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
        case "a":
          if (selected.size === items.length) selected.clear();
          else items.forEach((_, i) => selected.add(i));
          render();
          break;
        case "return":
          cleanup();
          resolve(items.filter((_, i) => selected.has(i)).map((item) => item.id));
          break;
        default:
          break;
      }
    };

    render();
    stdin.on("keypress", onKeypress);
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
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}
