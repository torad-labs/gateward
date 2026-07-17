import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { serializeBacklog } from "./backlog";
import { evaluateStop } from "./stop-hook";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "steer-"));
  fs.mkdirSync(path.join(dir, ".tenets"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BACKLOG_PATH;
});

function seed(statuses: string[]): void {
  const items = statuses.map((status, i) => ({
    id: `T${i + 1}`,
    title: `item ${i + 1}`,
    status: status as never,
    files: [],
    verify: "",
    notes: [],
  }));
  fs.writeFileSync(path.join(dir, ".tenets", "backlog.toml"), serializeBacklog(items));
}

test("blocks the stop while an item is open, and names it", () => {
  seed(["done", "todo"]);
  const decision = evaluateStop({ cwd: dir });
  expect(decision?.decision).toBe("block");
  expect(decision?.reason).toContain("T2");
  expect(decision?.reason).toContain("open item");
});

test("allows the stop when every item is done or verified", () => {
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
