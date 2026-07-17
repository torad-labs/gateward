import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sha256 } from "./lock";
import { listSourceFiles, looksLikeTestFile, removeVendored, vendorDir, vendorInto, writeIfChanged } from "./vendor";

async function tmpdir(prefix: string): Promise<string> {
  const dir = path.join(os.tmpdir(), prefix + crypto.randomUUID());
  await Bun.$`mkdir -p ${dir}`.quiet();
  return dir;
}

test("writeIfChanged: created, then unchanged, then updated", async () => {
  const dir = await tmpdir("vendor-test-");
  try {
    const file = path.join(dir, "nested", "file.txt");
    expect(await writeIfChanged(file, "hello")).toBe("created");
    expect(await Bun.file(file).text()).toBe("hello");
    expect(await writeIfChanged(file, "hello")).toBe("unchanged");
    expect(await writeIfChanged(file, "goodbye")).toBe("updated");
    expect(await Bun.file(file).text()).toBe("goodbye");
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});

test("vendorDir: recursively copies files, preserving relative structure and hashing content", async () => {
  const src = await tmpdir("vendor-src-");
  const dest = await tmpdir("vendor-dest-");
  try {
    await Bun.write(path.join(src, "pack.yml"), "id: x\n");
    fs.mkdirSync(path.join(src, "rules"));
    await Bun.write(path.join(src, "rules", "one.yml"), "rule: one\n");

    const results = await vendorDir(src, dest);
    const byPath = Object.fromEntries(results.map((r) => [r.relPath, r]));

    expect(Object.keys(byPath).length).toBe(2);
    const packYml = byPath["pack.yml"];
    if (packYml === undefined) throw new Error("expected pack.yml in vendor results");
    expect(packYml.result).toBe("created");
    expect(packYml.hash).toBe(sha256("id: x\n"));
    const rulesOneYml = byPath["rules/one.yml"];
    if (rulesOneYml === undefined) throw new Error("expected rules/one.yml in vendor results");
    expect(rulesOneYml.result).toBe("created");
    expect(await Bun.file(path.join(dest, "pack.yml")).text()).toBe("id: x\n");
    expect(await Bun.file(path.join(dest, "rules", "one.yml")).text()).toBe("rule: one\n");
  } finally {
    await Bun.$`rm -rf ${src}`.quiet();
    await Bun.$`rm -rf ${dest}`.quiet();
  }
});

test("vendorDir: skips .gitkeep placeholders", async () => {
  const src = await tmpdir("vendor-src-");
  const dest = await tmpdir("vendor-dest-");
  try {
    await Bun.write(path.join(src, ".gitkeep"), "");
    await Bun.write(path.join(src, "real.ts"), "export {};\n");

    const results = await vendorDir(src, dest);
    expect(results.map((r) => r.relPath)).toEqual(["real.ts"]);
    expect(fs.existsSync(path.join(dest, ".gitkeep"))).toBe(false);
  } finally {
    await Bun.$`rm -rf ${src}`.quiet();
    await Bun.$`rm -rf ${dest}`.quiet();
  }
});

test("vendorDir: re-running with unchanged source reports 'unchanged' for every file", async () => {
  const src = await tmpdir("vendor-src-");
  const dest = await tmpdir("vendor-dest-");
  try {
    await Bun.write(path.join(src, "a.txt"), "a");
    await vendorDir(src, dest);
    const second = await vendorDir(src, dest);
    expect(second.map((r) => r.result)).toEqual(["unchanged"]);
  } finally {
    await Bun.$`rm -rf ${src}`.quiet();
    await Bun.$`rm -rf ${dest}`.quiet();
  }
});

test("vendorInto: a single source file is copied into the destination directory by basename", async () => {
  const src = await tmpdir("vendor-src-");
  const dest = await tmpdir("vendor-dest-");
  try {
    const shimFile = path.join(src, "shim.js");
    await Bun.write(shimFile, "module.exports = {};\n");
    const results = await vendorInto(shimFile, dest);
    expect(results.length).toBe(1);
    const [first] = results;
    if (first === undefined) throw new Error("expected one vendored result");
    expect(first.relPath).toBe("shim.js");
    expect(await Bun.file(path.join(dest, "shim.js")).text()).toBe("module.exports = {};\n");
  } finally {
    await Bun.$`rm -rf ${src}`.quiet();
    await Bun.$`rm -rf ${dest}`.quiet();
  }
});

test("listSourceFiles: enumerates without copying, skips .gitkeep, forward-slash relative paths", async () => {
  const src = await tmpdir("vendor-src-");
  try {
    await Bun.write(path.join(src, ".gitkeep"), "");
    await Bun.write(path.join(src, "events", "pretooluse.ts"), "x");
    await Bun.write(path.join(src, "config.ts"), "z");

    const files = (await listSourceFiles(src)).map((f) => f.relPath).sort();
    expect(files).toEqual(["config.ts", "events/pretooluse.ts"]);
  } finally {
    await Bun.$`rm -rf ${src}`.quiet();
  }
});

test("looksLikeTestFile: recognizes the real shim naming convention observed in packages/shims", () => {
  expect(looksLikeTestFile("test_claude_compat.py")).toBe(true);
  expect(looksLikeTestFile("smoke-test.js")).toBe(true);
  expect(looksLikeTestFile("claude_compat.test.ts")).toBe(true); // bun:test infix — the shim's own test
  expect(looksLikeTestFile("gateward.spec.ts")).toBe(true);
  expect(looksLikeTestFile("claude_compat.py")).toBe(false);
  expect(looksLikeTestFile("claude_compat.ts")).toBe(false); // the real shim entrypoint, not a test
  expect(looksLikeTestFile("gateward.js")).toBe(false);
  expect(looksLikeTestFile("latest.js")).toBe(false); // contains "test" but no separator before it
  expect(looksLikeTestFile("entry.py")).toBe(false);
});

test("vendorInto with exclude: a test-shaped file in a shim directory is skipped, the real entrypoint is not", async () => {
  const src = await tmpdir("vendor-src-");
  const dest = await tmpdir("vendor-dest-");
  try {
    await Bun.write(path.join(src, "gateward.js"), "module.exports = {};\n");
    await Bun.write(path.join(src, "smoke-test.js"), "assert(true);\n");
    const results = await vendorInto(src, dest, { exclude: looksLikeTestFile });
    expect(results.map((r) => r.relPath).sort()).toEqual(["gateward.js"]);
    expect(fs.existsSync(path.join(dest, "smoke-test.js"))).toBe(false);
  } finally {
    await Bun.$`rm -rf ${src}`.quiet();
    await Bun.$`rm -rf ${dest}`.quiet();
  }
});

test("removeVendored: deletes the directory; is a no-op when it doesn't exist", async () => {
  const dest = await tmpdir("vendor-dest-");
  await Bun.write(path.join(dest, "keep.txt"), "x");
  await removeVendored(dest);
  expect(fs.existsSync(dest)).toBe(false);
  expect(async () => await removeVendored(dest)).not.toThrow();
});
