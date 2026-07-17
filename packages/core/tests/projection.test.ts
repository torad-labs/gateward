/** Unit tests for projection: Write is content-as-is; Edit is replayed
 * against the on-disk file; anything undecidable returns null (silent allow). */

import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { project } from "../src/projection";

async function freshDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `core-projection-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${dir}`.quiet();
  return dir;
}

async function writeTemp(body: string): Promise<string> {
  const target = path.join(await freshDir(), "File.kt");
  await Bun.write(target, body);
  return target;
}

test("Write: new file, content as-is with empty current", async () => {
  const target = path.join(await freshDir(), "New.kt");
  const result = await project("Write", { file_path: target, content: "val x = 1\n" });
  if (!result) throw new Error("projection expected");
  expect(result.toolName).toBe("Write");
  expect(result.current).toBe("");
  expect(result.projected).toBe("val x = 1\n");
});

test("Write: existing file supplies current", async () => {
  const target = await writeTemp("old body\n");
  const result = await project("Write", { file_path: target, content: "new body\n" });
  if (!result) throw new Error("projection expected");
  expect(result.current).toBe("old body\n");
  expect(result.projected).toBe("new body\n");
});

test("Write: missing content is not ours", async () => {
  expect(await project("Write", { file_path: "/tmp/x.kt" })).toBeNull();
});

test("Edit: first occurrence only by default", async () => {
  const target = await writeTemp("a a a");
  const result = await project("Edit", { file_path: target, old_string: "a", new_string: "b" });
  if (!result) throw new Error("projection expected");
  expect(result.projected).toBe("b a a");
  expect(result.current).toBe("a a a");
});

test("Edit: replace_all", async () => {
  const target = await writeTemp("a a a");
  const result = await project("Edit", {
    file_path: target,
    old_string: "a",
    new_string: "b",
    replace_all: true,
  });
  if (!result) throw new Error("projection expected");
  expect(result.projected).toBe("b b b");
});

test("Edit: absent old_string is undecidable", async () => {
  const target = await writeTemp("hello");
  expect(await project("Edit", { file_path: target, old_string: "zzz", new_string: "y" })).toBeNull();
});

test("Edit: missing file is undecidable", async () => {
  const missing = path.join(await freshDir(), "Absent.kt");
  expect(await project("Edit", { file_path: missing, old_string: "a", new_string: "b" })).toBeNull();
});

test("Edit: empty old_string is undecidable", async () => {
  const target = await writeTemp("hello");
  expect(await project("Edit", { file_path: target, old_string: "", new_string: "y" })).toBeNull();
});

test("unknown tool is not ours", async () => {
  expect(await project("Bash", { file_path: "/tmp/x.kt" })).toBeNull();
});

test("missing file_path is not ours", async () => {
  expect(await project("Write", { content: "x" })).toBeNull();
});
