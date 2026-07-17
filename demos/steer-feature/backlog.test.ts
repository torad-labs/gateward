import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type Item,
  mutateBacklog,
  openItems,
  parseBacklog,
  readBacklog,
  serializeBacklog,
} from "./backlog";

const SAMPLE: Item[] = [
  { id: "T1", title: "wire the thing", status: "todo", files: ["a.kt", "b.kt"], verify: "bun test", notes: ["decided: keep it sync"] },
  { id: "T2", title: "prove the thing", status: "verified", files: [], verify: "", notes: [] },
];

test("serialize -> parse round-trips exactly", () => {
  expect(parseBacklog(serializeBacklog(SAMPLE))).toEqual(SAMPLE);
});

test("notes with quotes and backslashes survive a round-trip", () => {
  const items: Item[] = [
    { id: "T1", title: 'has "quotes" and a\\slash', status: "in_flight", files: [], verify: "", notes: ['a "quoted" note'] },
  ];
  expect(parseBacklog(serializeBacklog(items))).toEqual(items);
});

test("openItems returns only todo and in_flight", () => {
  const items = parseBacklog(
    serializeBacklog([
      { id: "A", title: "", status: "todo", files: [], verify: "", notes: [] },
      { id: "B", title: "", status: "in_flight", files: [], verify: "", notes: [] },
      { id: "C", title: "", status: "done", files: [], verify: "", notes: [] },
      { id: "D", title: "", status: "verified", files: [], verify: "", notes: [] },
    ]),
  );
  expect(openItems(items).map((i) => i.id)).toEqual(["A", "B"]);
});

test("mutateBacklog is atomic and appends a note", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-"));
  const file = path.join(dir, "backlog.toml");
  fs.writeFileSync(file, serializeBacklog(SAMPLE));
  try {
    mutateBacklog(file, (items) => {
      const item = items.find((i) => i.id === "T1")!;
      item.status = "done";
      item.notes.push("2026-07-17 landed");
      return items;
    });
    const reloaded = readBacklog(file);
    const t1 = reloaded.find((i) => i.id === "T1")!;
    expect(t1.status).toBe("done");
    expect(t1.notes).toContain("2026-07-17 landed");
    expect(fs.existsSync(`${file}.lock`)).toBe(false); // lock released
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
