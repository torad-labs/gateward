/**
 * The one required integration test: invokes the real CLI entrypoint
 * (src/index.ts, run directly by Bun — there is no build step) as a real
 * child process against a temp directory fixture, exactly as a user would
 * run it. Everything else in this package is unit-tested against
 * in-process functions; this is the only test that spawns the CLI.
 */

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DENY_PERMISSION_DECISION_RE = /"permissionDecision":\s*"deny"/;
const NO_FORCE_UNWRAP_RE = /no-force-unwrap/;
const NO_CHANGES_RE = /no changes/i;

// integration.test.ts sits beside index.ts, so this resolves correctly
// regardless of cwd. Under Bun, process.execPath is the Bun binary itself.
const CLI_ENTRY = path.join(import.meta.dir, "index.ts");

interface CliRun {
  stdout: string;
  stderr: string;
  status: number;
}

function runCli(args: string[], cwd: string): CliRun {
  const result = Bun.spawnSync({ cmd: [process.execPath, CLI_ENTRY, ...args], cwd });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    status: result.exitCode ?? 1,
  };
}

function countVendoredFilesAndCheckLock(dir: string, prefix: string, lockKeys: Set<string>): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      count += countVendoredFilesAndCheckLock(abs, rel, lockKeys);
    } else {
      count++;
      // biome-ignore lint/suspicious/noMisplacedAssertion: expect() inside a test helper by design, called only from within the test below
      expect(lockKeys.has(rel), `lock.json is missing an entry for ${rel}`).toBeTruthy();
    }
  }
  return count;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one end-to-end story, reads top-to-bottom
test("integration: init -y --packs all vendors 5 packs + engine, merges Claude settings, and is idempotent on rerun", async () => {
  const projectRoot = path.join(os.tmpdir(), `gateward-integration-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${projectRoot}`.quiet();
  try {
    // A realistic target project: an existing user hook Claude Code already
    // has wired, plus a Kotlin source file the vendored rules would gate.
    fs.mkdirSync(path.join(projectRoot, ".claude"), { recursive: true });
    const userSettings = {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/my-user-hook.sh" }] }],
      },
    };
    await Bun.write(path.join(projectRoot, ".claude", "settings.json"), `${JSON.stringify(userSettings, null, 2)}\n`);
    fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
    await Bun.write(path.join(projectRoot, "src", "Foo.kt"), "class Foo\n");

    const first = runCli(["init", "-y", "--packs", "all"], projectRoot);
    expect(first.status, `first init failed:\n${first.stdout}\n${first.stderr}`).toBe(0);

    // .tenets/packs has 5 packs.
    const packsDir = path.join(projectRoot, ".tenets", "packs");
    const packDirs = fs
      .readdirSync(packsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(packDirs).toEqual([
      "android-architecture",
      "android-best-practices",
      "android-opinionated",
      "bun-best-practices",
      "kotlin-best-practices",
    ]);

    // Engine vendored.
    const engineDir = path.join(projectRoot, ".tenets", "engine");
    expect(
      await Bun.file(path.join(engineDir, "config.ts")).exists(),
      "engine/config.ts should be vendored",
    ).toBeTruthy();
    expect(
      await Bun.file(path.join(engineDir, "events", "pretooluse.ts")).exists(),
      "engine/events/pretooluse.ts should be vendored",
    ).toBeTruthy();

    // Lock covers all vendored files.
    const lock = JSON.parse(await Bun.file(path.join(projectRoot, ".tenets", "lock.json")).text()) as {
      files: Record<string, string>;
    };
    const lockKeys = new Set(Object.keys(lock.files));
    const vendoredCount =
      countVendoredFilesAndCheckLock(packsDir, "packs", lockKeys) +
      countVendoredFilesAndCheckLock(engineDir, "engine", lockKeys);
    expect(Object.keys(lock.files).length).toBe(vendoredCount);

    // settings.json contains BOTH the pre-existing user hook and our new one.
    const mergedSettings = JSON.parse(await Bun.file(path.join(projectRoot, ".claude", "settings.json")).text()) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    const preToolUse = mergedSettings.hooks.PreToolUse;
    expect(preToolUse.length).toBe(2);
    expect(preToolUse.some((e) => e.hooks.some((h) => h.command === "/usr/local/bin/my-user-hook.sh"))).toBeTruthy();
    expect(
      preToolUse.some((e) => e.hooks.some((h) => h.command.includes(".tenets/engine/events/pretooluse.ts"))),
    ).toBeTruthy();

    // The wired hook actually FIRES — the regression this test originally
    // missed: layout can be perfect while the command dies with exit 126.
    const wiredCommand = preToolUse
      .flatMap((e) => e.hooks)
      .map((h) => h.command)
      .find((c) => c.includes(".tenets/engine/events/pretooluse.ts"));
    if (!wiredCommand) throw new Error("wired hook command not found");
    const payload = JSON.stringify({
      tool_name: "Write",
      tool_input: {
        file_path: path.join(projectRoot, "src", "main", "kotlin", "Bad.kt"),
        content: "class Bad { fun f(x: String?) = x!!.length }",
      },
    });
    const hookRun = Bun.spawnSync({
      cmd: ["bash", "-c", wiredCommand],
      stdin: new TextEncoder().encode(payload),
      env: { ...Bun.env, CLAUDE_PROJECT_DIR: projectRoot },
    });
    const verdict = hookRun.stdout.toString();
    expect(verdict).toMatch(DENY_PERMISSION_DECISION_RE);
    expect(verdict).toMatch(NO_FORCE_UNWRAP_RE);

    // Second run reports no changes, and every file is byte-identical.
    const beforeLock = await Bun.file(path.join(projectRoot, ".tenets", "lock.json")).text();
    const beforeConfig = await Bun.file(path.join(projectRoot, ".tenets", "config.toml")).text();
    const beforeSettings = await Bun.file(path.join(projectRoot, ".claude", "settings.json")).text();

    const second = runCli(["init", "-y", "--packs", "all"], projectRoot);
    expect(second.status, `second init failed:\n${second.stdout}\n${second.stderr}`).toBe(0);
    expect(second.stdout).toMatch(NO_CHANGES_RE);

    expect(await Bun.file(path.join(projectRoot, ".tenets", "lock.json")).text()).toBe(beforeLock);
    expect(await Bun.file(path.join(projectRoot, ".tenets", "config.toml")).text()).toBe(beforeConfig);
    expect(await Bun.file(path.join(projectRoot, ".claude", "settings.json")).text()).toBe(beforeSettings);
  } finally {
    await Bun.$`rm -rf ${projectRoot}`.quiet();
  }
});
