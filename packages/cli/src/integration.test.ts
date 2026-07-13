/**
 * The one required integration test: invokes the BUILT CLI (dist/index.js)
 * as a real child process against a temp directory fixture, exactly as a
 * user would run it. Everything else in this package is unit-tested against
 * in-process functions; this is the only test that spawns the compiled bin.
 */
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

// integration.test.ts compiles to dist/integration.test.js, a sibling of
// dist/index.js, so this resolves correctly regardless of cwd.
const CLI_ENTRY = path.join(__dirname, "index.js");

interface CliRun {
  stdout: string;
  status: number;
}

function runCli(args: string[], cwd: string): CliRun {
  try {
    const stdout = execFileSync("node", [CLI_ENTRY, ...args], { cwd, encoding: "utf8" });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; status?: number | null };
    return { stdout: e.stdout ? e.stdout.toString() : "", status: e.status ?? 1 };
  }
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
      assert.ok(lockKeys.has(rel), `lock.json is missing an entry for ${rel}`);
    }
  }
  return count;
}

test("integration: init -y --packs all vendors 4 packs + engine, merges Claude settings, and is idempotent on rerun", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "portable-hooks-integration-"));
  try {
    // A realistic target project: an existing user hook Claude Code already
    // has wired, plus a Kotlin source file the vendored rules would gate.
    fs.mkdirSync(path.join(projectRoot, ".claude"), { recursive: true });
    const userSettings = {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/my-user-hook.sh" }] }],
      },
    };
    fs.writeFileSync(
      path.join(projectRoot, ".claude", "settings.json"),
      JSON.stringify(userSettings, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "src", "Foo.kt"), "class Foo\n");

    const first = runCli(["init", "-y", "--packs", "all"], projectRoot);
    assert.equal(first.status, 0, `first init failed:\n${first.stdout}`);

    // .tenets/packs has 4 packs.
    const packsDir = path.join(projectRoot, ".tenets", "packs");
    const packDirs = fs
      .readdirSync(packsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assert.deepEqual(packDirs, [
      "android-architecture",
      "android-best-practices",
      "android-opinionated",
      "kotlin-best-practices",
    ]);

    // Engine vendored.
    const engineDir = path.join(projectRoot, ".tenets", "engine");
    assert.ok(fs.existsSync(path.join(engineDir, "config.py")), "engine/config.py should be vendored");
    assert.ok(fs.existsSync(path.join(engineDir, "events", "pretooluse.py")), "engine/events/pretooluse.py should be vendored");

    // Lock covers all vendored files.
    const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, ".tenets", "lock.json"), "utf8")) as {
      files: Record<string, string>;
    };
    const lockKeys = new Set(Object.keys(lock.files));
    const vendoredCount =
      countVendoredFilesAndCheckLock(packsDir, "packs", lockKeys) + countVendoredFilesAndCheckLock(engineDir, "engine", lockKeys);
    assert.equal(Object.keys(lock.files).length, vendoredCount);

    // settings.json contains BOTH the pre-existing user hook and our new one.
    const mergedSettings = JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude", "settings.json"), "utf8")) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    const preToolUse = mergedSettings.hooks.PreToolUse;
    assert.equal(preToolUse.length, 2);
    assert.ok(preToolUse.some((e) => e.hooks.some((h) => h.command === "/usr/local/bin/my-user-hook.sh")));
    assert.ok(preToolUse.some((e) => e.hooks.some((h) => h.command.includes(".tenets/engine/events/pretooluse.py"))));

    // The wired hook actually FIRES — the regression this test originally
    // missed: layout can be perfect while the command dies with exit 126.
    const wiredCommand = preToolUse
      .flatMap((e) => e.hooks)
      .map((h) => h.command)
      .find((c) => c.includes(".tenets/engine/events/pretooluse.py"));
    assert.ok(wiredCommand, "wired hook command not found");
    const payload = JSON.stringify({
      tool_name: "Write",
      tool_input: {
        file_path: path.join(projectRoot, "src", "main", "kotlin", "Bad.kt"),
        content: "class Bad { fun f(x: String?) = x!!.length }",
      },
    });
    const verdict = execFileSync("bash", ["-c", wiredCommand], {
      input: payload,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      encoding: "utf8",
    });
    assert.match(verdict, /"permissionDecision":\s*"deny"/);
    assert.match(verdict, /no-force-unwrap/);

    // Second run reports no changes, and every file is byte-identical.
    const beforeLock = fs.readFileSync(path.join(projectRoot, ".tenets", "lock.json"), "utf8");
    const beforeConfig = fs.readFileSync(path.join(projectRoot, ".tenets", "config.toml"), "utf8");
    const beforeSettings = fs.readFileSync(path.join(projectRoot, ".claude", "settings.json"), "utf8");

    const second = runCli(["init", "-y", "--packs", "all"], projectRoot);
    assert.equal(second.status, 0, `second init failed:\n${second.stdout}`);
    assert.match(second.stdout, /no changes/i);

    assert.equal(fs.readFileSync(path.join(projectRoot, ".tenets", "lock.json"), "utf8"), beforeLock);
    assert.equal(fs.readFileSync(path.join(projectRoot, ".tenets", "config.toml"), "utf8"), beforeConfig);
    assert.equal(fs.readFileSync(path.join(projectRoot, ".claude", "settings.json"), "utf8"), beforeSettings);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
