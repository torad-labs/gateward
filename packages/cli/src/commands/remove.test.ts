import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInit } from "./init";
import { runRemove } from "./remove";

// This exercises runRemove() directly, in-process, against the real monorepo
// packs registry (via ../paths' PACKS_ROOT) — mirroring init.test.ts's approach.

async function tmpdir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `remove-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${dir}`.quiet();
  return dir;
}

test("runRemove: an unknown/traversal packId is refused as a usage error and deletes nothing", async () => {
  const root = await tmpdir();
  try {
    await runInit(root, { packsFlag: "kotlin-best-practices", yes: false });

    // A decoy directory sibling to .tenets — stands in for whatever a
    // traversal payload might otherwise reach (e.g. "../../../.ssh").
    const decoy = path.join(root, "decoy-marker");
    fs.mkdirSync(decoy);
    await Bun.write(path.join(decoy, "keep-me.txt"), "still here");

    let caughtErr: unknown;
    try {
      await runRemove(root, "../../../decoy-marker");
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeTruthy();
    expect(caughtErr instanceof Error).toBe(true);
    expect((caughtErr as { exitCode?: number }).exitCode).toBe(2);

    // Nothing was deleted: the decoy survives, and the legitimately
    // installed pack is untouched.
    expect(fs.existsSync(path.join(decoy, "keep-me.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".tenets", "packs", "kotlin-best-practices"))).toBe(true);
  } finally {
    await Bun.$`rm -rf ${root}`.quiet();
  }
});

test("runRemove: an unknown packId that isn't installed is refused before any config/lock is touched", async () => {
  const root = await tmpdir();
  try {
    await runInit(root, { packsFlag: "kotlin-best-practices", yes: false });
    const configPath = path.join(root, ".tenets", "config.toml");
    const before = await Bun.file(configPath).text();

    let caughtErr: unknown;
    try {
      await runRemove(root, "not-a-real-pack");
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeTruthy();
    expect((caughtErr as { exitCode?: number }).exitCode).toBe(2);
    expect(await Bun.file(configPath).text()).toBe(before);
  } finally {
    await Bun.$`rm -rf ${root}`.quiet();
  }
});

test("runRemove: a known, enabled pack is removed normally (behavior preserved)", async () => {
  const root = await tmpdir();
  try {
    await runInit(root, { packsFlag: "kotlin-best-practices", yes: false });
    const outcome = await runRemove(root, "kotlin-best-practices");
    expect(outcome.changed).toBe(true);
    expect(fs.existsSync(path.join(root, ".tenets", "packs", "kotlin-best-practices"))).toBe(false);
  } finally {
    await Bun.$`rm -rf ${root}`.quiet();
  }
});
