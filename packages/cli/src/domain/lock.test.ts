import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { buildLock, readLock, serializeLock, sha256, sha256File, toLockKey } from "./lock";

test("sha256: matches the NIST FIPS 180-4 known-answer test vector for 'abc'", () => {
  // biome-ignore lint/security/noSecrets: false positive — a published SHA-256 known-answer test vector, not a secret
  expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256: agrees with WebCrypto computed independently for arbitrary content", async () => {
  const content = "gateward vendored file content\nwith multiple lines\n";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const expected = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  expect(sha256(content)).toBe(expected);
});

test("sha256: different content produces different digests; same content is stable", () => {
  expect(sha256("a")).not.toBe(sha256("b"));
  expect(sha256("same")).toBe(sha256("same"));
});

test("sha256File: hashes the file's actual on-disk bytes", async () => {
  const dir = path.join(os.tmpdir(), `lock-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${dir}`.quiet();
  try {
    const file = path.join(dir, "content.txt");
    await Bun.write(file, "abc");
    expect(await sha256File(file)).toBe(sha256("abc"));
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});

test("toLockKey: identity on POSIX-style relative paths", () => {
  expect(toLockKey("packs/kotlin-best-practices/pack.yml")).toBe("packs/kotlin-best-practices/pack.yml");
});

test("buildLock: sorts file keys deterministically regardless of insertion order", () => {
  const lock = buildLock("gateward@0.1.0", {
    "engine/config.ts": sha256("config"),
    "engine/audit.ts": sha256("audit"),
    "packs/kotlin-best-practices/pack.yml": sha256("pack"),
  });
  expect(Object.keys(lock.files)).toEqual([
    "engine/audit.ts",
    "engine/config.ts",
    "packs/kotlin-best-practices/pack.yml",
  ]);
  expect(lock.version).toBe(1);
  expect(lock.source).toBe("gateward@0.1.0");
});

test("serializeLock + readLock round-trips through disk", async () => {
  const dir = path.join(os.tmpdir(), `lock-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${dir}`.quiet();
  try {
    const lock = buildLock("gateward@0.1.0", { "engine/config.ts": sha256("x") });
    await Bun.write(path.join(dir, "lock.json"), serializeLock(lock));
    const reread = await readLock(dir);
    expect(reread).toEqual(lock);
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});

test("readLock: returns null when lock.json is absent", async () => {
  const dir = path.join(os.tmpdir(), `lock-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${dir}`.quiet();
  try {
    expect(await readLock(dir)).toBe(null);
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});

test("readLock: returns null (not a throw) when lock.json is corrupt", async () => {
  const dir = path.join(os.tmpdir(), `lock-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${dir}`.quiet();
  try {
    await Bun.write(path.join(dir, "lock.json"), "{ not json");
    expect(await readLock(dir)).toBe(null);
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});
