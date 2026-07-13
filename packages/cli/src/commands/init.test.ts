import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInit } from "./init";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "init-idempotent-test-"));
}

// This exercises runInit() directly, in-process, against the real monorepo
// packs/engine (via ../paths' PACKS_ROOT/CORE_SRC) — unlike integration.test.ts,
// which spawns the compiled CLI as a subprocess. Both target the same behavior
// from different angles: this one isolates "is init's own logic idempotent",
// independent of process-spawning/argv-parsing concerns.

test("runInit: a second run with the same options changes nothing and says so", async () => {
  const root = tmpdir();
  try {
    const first = await runInit(root, { packsFlag: "all", yes: false });
    assert.equal(first.changed, true);

    const tenetsSnapshot = snapshotTenets(root);

    const second = await runInit(root, { packsFlag: "all", yes: false });
    assert.equal(second.changed, false);
    assert.ok(second.lines.some((l) => /no changes/i.test(l)), second.lines.join("\n"));

    assert.deepEqual(snapshotTenets(root), tenetsSnapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runInit: a single selected pack vendors only that pack, and rerunning it is still idempotent", async () => {
  const root = tmpdir();
  try {
    const first = await runInit(root, { packsFlag: "kotlin-best-practices", yes: false });
    assert.equal(first.changed, true);
    const packsDir = path.join(root, ".tenets", "packs");
    assert.deepEqual(fs.readdirSync(packsDir), ["kotlin-best-practices"]);

    const second = await runInit(root, { packsFlag: "kotlin-best-practices", yes: false });
    assert.equal(second.changed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runInit: an unknown --packs id is a usage error (exit code 2), not a runtime crash", async () => {
  const root = tmpdir();
  try {
    await assert.rejects(
      () => runInit(root, { packsFlag: "not-a-real-pack", yes: false }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { exitCode?: number }).exitCode, 2);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function snapshotTenets(root: string): Record<string, string> {
  const tenets = path.join(root, ".tenets");
  const claudeSettings = path.join(root, ".claude", "settings.json");
  const snapshot: Record<string, string> = {};
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else snapshot[relPath] = fs.readFileSync(abs, "utf8");
    }
  };
  walk(tenets, "");
  snapshot["<claude-settings>"] = fs.readFileSync(claudeSettings, "utf8");
  return snapshot;
}
