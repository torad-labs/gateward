import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInit } from "./init";

async function tmpdir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `init-idempotent-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${dir}`.quiet();
  return dir;
}

// This exercises runInit() directly, in-process, against the real monorepo
// packs/engine (via ../paths' PACKS_ROOT/CORE_SRC) — unlike integration.test.ts,
// which spawns the compiled CLI as a subprocess. Both target the same behavior
// from different angles: this one isolates "is init's own logic idempotent",
// independent of process-spawning/argv-parsing concerns.

test("runInit: a second run with the same options changes nothing and says so", async () => {
  const root = await tmpdir();
  try {
    const first = await runInit(root, { packsFlag: "all", yes: false });
    expect(first.changed).toBe(true);

    const tenetsSnapshot = await snapshotTenets(root);

    const second = await runInit(root, { packsFlag: "all", yes: false });
    expect(second.changed).toBe(false);
    expect(
      second.lines.some((l) => /no changes/i.test(l)),
      second.lines.join("\n"),
    ).toBeTruthy();

    expect(await snapshotTenets(root)).toEqual(tenetsSnapshot);
  } finally {
    await Bun.$`rm -rf ${root}`.quiet();
  }
});

test("runInit: a single selected pack vendors only that pack, and rerunning it is still idempotent", async () => {
  const root = await tmpdir();
  try {
    const first = await runInit(root, { packsFlag: "kotlin-best-practices", yes: false });
    expect(first.changed).toBe(true);
    const packsDir = path.join(root, ".tenets", "packs");
    expect(fs.readdirSync(packsDir)).toEqual(["kotlin-best-practices"]);

    const second = await runInit(root, { packsFlag: "kotlin-best-practices", yes: false });
    expect(second.changed).toBe(false);
  } finally {
    await Bun.$`rm -rf ${root}`.quiet();
  }
});

test("runInit: an unknown --packs id is a usage error (exit code 2), not a runtime crash", async () => {
  const root = await tmpdir();
  try {
    let caughtErr: unknown;
    try {
      await runInit(root, { packsFlag: "not-a-real-pack", yes: false });
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeTruthy();
    expect(caughtErr instanceof Error).toBe(true);
    expect((caughtErr as { exitCode?: number }).exitCode).toBe(2);
  } finally {
    await Bun.$`rm -rf ${root}`.quiet();
  }
});

async function snapshotTenets(root: string): Promise<Record<string, string>> {
  const tenets = path.join(root, ".tenets");
  const claudeSettings = path.join(root, ".claude", "settings.json");
  const snapshot: Record<string, string> = {};
  const walk = async (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(abs, relPath);
      else snapshot[relPath] = await Bun.file(abs).text();
    }
  };
  await walk(tenets, "");
  snapshot["<claude-settings>"] = await Bun.file(claudeSettings).text();
  return snapshot;
}
