import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { buildLock, readLock, serializeLock, sha256, sha256File, toLockKey } from "./lock";

test("sha256: matches the NIST FIPS 180-4 known-answer test vector for 'abc'", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256: agrees with node:crypto computed independently for arbitrary content", () => {
  const content = "portable-hooks vendored file content\nwith multiple lines\n";
  const expected = crypto.createHash("sha256").update(content).digest("hex");
  assert.equal(sha256(content), expected);
});

test("sha256: different content produces different digests; same content is stable", () => {
  assert.notEqual(sha256("a"), sha256("b"));
  assert.equal(sha256("same"), sha256("same"));
});

test("sha256File: hashes the file's actual on-disk bytes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
  try {
    const file = path.join(dir, "content.txt");
    fs.writeFileSync(file, "abc");
    assert.equal(sha256File(file), sha256("abc"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("toLockKey: identity on POSIX-style relative paths", () => {
  assert.equal(toLockKey("packs/kotlin-best-practices/pack.yml"), "packs/kotlin-best-practices/pack.yml");
});

test("buildLock: sorts file keys deterministically regardless of insertion order", () => {
  const lock = buildLock("portable-hooks@0.1.0", {
    "engine/config.py": sha256("config"),
    "engine/audit.py": sha256("audit"),
    "packs/kotlin-best-practices/pack.yml": sha256("pack"),
  });
  assert.deepEqual(Object.keys(lock.files), [
    "engine/audit.py",
    "engine/config.py",
    "packs/kotlin-best-practices/pack.yml",
  ]);
  assert.equal(lock.version, 1);
  assert.equal(lock.source, "portable-hooks@0.1.0");
});

test("serializeLock + readLock round-trips through disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
  try {
    const lock = buildLock("portable-hooks@0.1.0", { "engine/config.py": sha256("x") });
    fs.writeFileSync(path.join(dir, "lock.json"), serializeLock(lock));
    const reread = readLock(dir);
    assert.deepEqual(reread, lock);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readLock: returns null when lock.json is absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
  try {
    assert.equal(readLock(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readLock: returns null (not a throw) when lock.json is corrupt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
  try {
    fs.writeFileSync(path.join(dir, "lock.json"), "{ not json");
    assert.equal(readLock(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
