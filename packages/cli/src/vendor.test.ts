import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { sha256 } from "./lock";
import { listSourceFiles, looksLikeTestFile, removeVendored, vendorDir, vendorInto, writeIfChanged } from "./vendor";

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("writeIfChanged: created, then unchanged, then updated", () => {
  const dir = tmpdir("vendor-test-");
  try {
    const file = path.join(dir, "nested", "file.txt");
    assert.equal(writeIfChanged(file, "hello"), "created");
    assert.equal(fs.readFileSync(file, "utf8"), "hello");
    assert.equal(writeIfChanged(file, "hello"), "unchanged");
    assert.equal(writeIfChanged(file, "goodbye"), "updated");
    assert.equal(fs.readFileSync(file, "utf8"), "goodbye");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("vendorDir: recursively copies files, preserving relative structure and hashing content", () => {
  const src = tmpdir("vendor-src-");
  const dest = tmpdir("vendor-dest-");
  try {
    fs.writeFileSync(path.join(src, "pack.yml"), "id: x\n");
    fs.mkdirSync(path.join(src, "rules"));
    fs.writeFileSync(path.join(src, "rules", "one.yml"), "rule: one\n");

    const results = vendorDir(src, dest);
    const byPath = Object.fromEntries(results.map((r) => [r.relPath, r]));

    assert.equal(Object.keys(byPath).length, 2);
    assert.equal(byPath["pack.yml"].result, "created");
    assert.equal(byPath["pack.yml"].hash, sha256("id: x\n"));
    assert.equal(byPath["rules/one.yml"].result, "created");
    assert.equal(fs.readFileSync(path.join(dest, "pack.yml"), "utf8"), "id: x\n");
    assert.equal(fs.readFileSync(path.join(dest, "rules", "one.yml"), "utf8"), "rule: one\n");
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("vendorDir: skips .gitkeep and __pycache__", () => {
  const src = tmpdir("vendor-src-");
  const dest = tmpdir("vendor-dest-");
  try {
    fs.writeFileSync(path.join(src, ".gitkeep"), "");
    fs.mkdirSync(path.join(src, "__pycache__"));
    fs.writeFileSync(path.join(src, "__pycache__", "config.cpython-313.pyc"), "binary-ish");
    fs.writeFileSync(path.join(src, "real.py"), "print(1)\n");

    const results = vendorDir(src, dest);
    assert.deepEqual(results.map((r) => r.relPath), ["real.py"]);
    assert.equal(fs.existsSync(path.join(dest, ".gitkeep")), false);
    assert.equal(fs.existsSync(path.join(dest, "__pycache__")), false);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("vendorDir: re-running with unchanged source reports 'unchanged' for every file", () => {
  const src = tmpdir("vendor-src-");
  const dest = tmpdir("vendor-dest-");
  try {
    fs.writeFileSync(path.join(src, "a.txt"), "a");
    vendorDir(src, dest);
    const second = vendorDir(src, dest);
    assert.deepEqual(second.map((r) => r.result), ["unchanged"]);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("vendorInto: a single source file is copied into the destination directory by basename", () => {
  const src = tmpdir("vendor-src-");
  const dest = tmpdir("vendor-dest-");
  try {
    const shimFile = path.join(src, "shim.js");
    fs.writeFileSync(shimFile, "module.exports = {};\n");
    const results = vendorInto(shimFile, dest);
    assert.equal(results.length, 1);
    assert.equal(results[0].relPath, "shim.js");
    assert.equal(fs.readFileSync(path.join(dest, "shim.js"), "utf8"), "module.exports = {};\n");
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("listSourceFiles: enumerates without copying, skips .gitkeep/__pycache__, forward-slash relative paths", () => {
  const src = tmpdir("vendor-src-");
  try {
    fs.writeFileSync(path.join(src, ".gitkeep"), "");
    fs.mkdirSync(path.join(src, "events"));
    fs.writeFileSync(path.join(src, "events", "pretooluse.py"), "x");
    fs.mkdirSync(path.join(src, "__pycache__"));
    fs.writeFileSync(path.join(src, "__pycache__", "x.pyc"), "y");
    fs.writeFileSync(path.join(src, "config.py"), "z");

    const files = listSourceFiles(src).map((f) => f.relPath).sort();
    assert.deepEqual(files, ["config.py", "events/pretooluse.py"]);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test("looksLikeTestFile: recognizes the real shim naming convention observed in packages/shims", () => {
  assert.equal(looksLikeTestFile("test_claude_compat.py"), true);
  assert.equal(looksLikeTestFile("smoke-test.js"), true);
  assert.equal(looksLikeTestFile("claude_compat.py"), false);
  assert.equal(looksLikeTestFile("portable-hooks.js"), false);
  assert.equal(looksLikeTestFile("latest.js"), false); // contains "test" but no separator before it
  assert.equal(looksLikeTestFile("entry.py"), false);
});

test("vendorInto with exclude: a test-shaped file in a shim directory is skipped, the real entrypoint is not", () => {
  const src = tmpdir("vendor-src-");
  const dest = tmpdir("vendor-dest-");
  try {
    fs.writeFileSync(path.join(src, "portable-hooks.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(src, "smoke-test.js"), "assert(true);\n");
    const results = vendorInto(src, dest, { exclude: looksLikeTestFile });
    assert.deepEqual(
      results.map((r) => r.relPath).sort(),
      ["portable-hooks.js"],
    );
    assert.equal(fs.existsSync(path.join(dest, "smoke-test.js")), false);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("removeVendored: deletes the directory; is a no-op when it doesn't exist", () => {
  const dest = tmpdir("vendor-dest-");
  fs.writeFileSync(path.join(dest, "keep.txt"), "x");
  removeVendored(dest);
  assert.equal(fs.existsSync(dest), false);
  assert.doesNotThrow(() => removeVendored(dest));
});
