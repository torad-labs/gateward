import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type Item, serializeBacklog } from "./backlog";
import { evaluateStop, renderPretty } from "./stop-hook";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "steer-"));
  fs.mkdirSync(path.join(dir, ".tenets"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BACKLOG_PATH;
});

function items(statuses: string[]): Item[] {
  return statuses.map((status, i) => ({
    id: `T${i + 1}`,
    title: `item ${i + 1}`,
    status: status as Item["status"],
    files: [],
    verify: "",
    notes: [],
  }));
}

function seed(statuses: string[]): void {
  fs.writeFileSync(path.join(dir, ".tenets", "backlog.toml"), serializeBacklog(items(statuses)));
}

test("blocks the stop while a task is open, with the count and the item", () => {
  seed(["done", "todo"]);
  const decision = evaluateStop({ cwd: dir });
  expect(decision?.decision).toBe("block");
  expect(decision?.reason).toContain("1 task(s) are still open");
  expect(decision?.reason).toContain("(1 todo)");
  expect(decision?.reason).toContain("T2");
});

test("counts both open statuses in the breakdown", () => {
  seed(["todo", "in_flight", "done"]);
  const decision = evaluateStop({ cwd: dir });
  expect(decision?.reason).toContain("2 task(s) are still open");
  expect(decision?.reason).toContain("(1 todo · 1 in_flight)");
});

test("allows the stop when every task is done or verified", () => {
  seed(["done", "verified"]);
  expect(evaluateStop({ cwd: dir })).toBeNull();
});

test("honors stop_hook_active to prevent an infinite block loop", () => {
  seed(["todo"]);
  expect(evaluateStop({ cwd: dir, stop_hook_active: true })).toBeNull();
});

test("allows the stop when there is no backlog at all", () => {
  expect(evaluateStop({ cwd: os.tmpdir() })).toBeNull();
});

test("renderPretty shows the blocked panel with a remaining count", () => {
  const panel = renderPretty(items(["todo", "in_flight", "done"]));
  expect(panel).toContain("STOP BLOCKED");
  expect(panel).toContain("2 task(s) remaining");
  expect(panel).toContain("T1");
  expect(panel).toContain("T2");
  expect(panel).not.toContain("T3"); // closed items are not listed as remaining
});

test("renderPretty shows the clear panel when nothing is open", () => {
  const panel = renderPretty(items(["done", "verified"]));
  expect(panel).toContain("STOP ALLOWED");
  expect(panel).toContain("backlog clear");
});

test("reason stays plain — no ANSI escapes in the model-facing contract", () => {
  seed(["todo"]);
  const decision = evaluateStop({ cwd: dir });
  expect(decision?.reason).not.toContain("\x1b[");
});
