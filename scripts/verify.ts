#!/usr/bin/env bun
/**
 * One-shot local verification — the same layers CI runs, in the same order.
 * Run from the repo root: `bun run verify`. Exits non-zero on the first
 * failing layer. Written with Bun.$ (Bun's built-in cross-platform shell).
 */
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "..");
const $ = Bun.$.cwd(REPO);

const steps: Array<[string, () => Promise<unknown>]> = [
  ["typecheck: packages/cli", () => Bun.$`bunx tsc --noEmit`.cwd(path.join(REPO, "packages", "cli"))],
  ["typecheck: packages/core", () => Bun.$`bunx tsc --noEmit`.cwd(path.join(REPO, "packages", "core"))],
  ["biome: format + lint", () => $`bunx biome ci .`],
  ["bun test: packages/cli", () => Bun.$`bun test`.cwd(path.join(REPO, "packages", "cli"))],
  ["bun test: packages/core", () => Bun.$`bun test`.cwd(path.join(REPO, "packages", "core"))],
  ["bun test: codex shim", () => $`bun test packages/shims/codex/claude_compat.test.ts`],
  ["opencode plugin smoke test", () => $`bun packages/shims/opencode/smoke-test.ts`],
  [
    "rule packs: ast-grep test",
    async () => {
      const glob = new Bun.Glob("*/sgconfig.yml");
      for await (const rel of glob.scan({ cwd: path.join(REPO, "packs") })) {
        const packDir = path.join(REPO, "packs", path.dirname(rel));
        await Bun.$`ast-grep test`.cwd(packDir);
      }
    },
  ],
  ["e2e payload replay", () => $`bun e2e/run.ts`],
  [
    "audit pins: golden=0, broken=52, self=0",
    async () => {
      const pin = async (target: string, expected: number) => {
        const out = await $`bun packages/core/src/audit.ts ${target} --json`.text();
        const total = (JSON.parse(out) as { total: number }).total;
        if (total !== expected) {
          throw new Error(`${target} audit is ${total}, pinned at ${expected}`);
        }
      };
      await pin("apps/golden", 0);
      await pin("apps/broken", 52);
      await pin(".", 0);
    },
  ],
];

let failed = false;
for (const [name, run] of steps) {
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    await run();
    process.stdout.write(`ok: ${name}\n`);
  } catch (error) {
    process.stdout.write(`FAILED: ${name}\n${error instanceof Error ? error.message : String(error)}\n`);
    failed = true;
    break;
  }
}

process.stdout.write(failed ? "\nverify: FAILED\n" : "\nverify: all layers green\n");
process.exitCode = failed ? 1 : 0;
