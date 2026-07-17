/**
 * Machine-checked architecture: the layering rules, stdout/exit-code
 * ownership, and the frozen `node:` builtin allowlist all fail CI here the
 * moment a new file violates them. Path-aware rules live in this test (the
 * write-time gate's rules are path-independent by design — see
 * ARCHITECTURE.md's "two enforcement layers").
 */

import { expect, test } from "bun:test";
import * as path from "node:path";

const SRC = import.meta.dir;

interface SourceModule {
  /** Forward-slash path relative to src/, e.g. "domain/vendor.ts". */
  rel: string;
  imports: string[];
  text: string;
}

async function loadModules(): Promise<SourceModule[]> {
  const glob = new Bun.Glob("**/*.ts");
  const modules: SourceModule[] = [];
  for await (const rel of glob.scan({ cwd: SRC })) {
    const normalized = rel.split(path.sep).join("/");
    const text = await Bun.file(path.join(SRC, rel)).text();
    const imports: string[] = [];
    for (const line of text.split("\n")) {
      const match = /^\s*(?:import|export)\b[^"']*["']([^"']+)["']/.exec(line);
      if (match) imports.push(match[1]);
    }
    modules.push({ rel: normalized, imports, text });
  }
  return modules.sort((a, b) => a.rel.localeCompare(b.rel));
}

const isTest = (rel: string) => rel.endsWith(".test.ts");

/**
 * The frozen `node:` allowlist — the exact builtins with NO Bun-native
 * equivalent, and exactly which files may import them. Growing this list is
 * an architecture decision, not a convenience: add the justification to
 * ARCHITECTURE.md's nativeness ledger in the same change.
 *
 * "*" = any non-test source file; "test" = any *.test.ts file.
 */
const NODE_ALLOWLIST: Record<string, ReadonlySet<string> | "test-and-source"> = {
  // Path manipulation: Bun has no path API; node:path IS Bun's native impl.
  "node:path": "test-and-source",
  // Structural fs ONLY — mkdir-as-fixture, readdir, stat/chmod (permission
  // mirroring), existence checks on directories. Content I/O is Bun.file /
  // Bun.write everywhere; fs never reads or writes file contents.
  "node:fs": new Set([
    "domain/vendor.ts",
    "harnesses/codex.ts",
    "harnesses/index.ts",
    "harnesses/opencode.ts",
    // Tests build real on-disk directory fixtures.
    "commands/init.test.ts",
    "domain/packs.test.ts",
    "domain/vendor.test.ts",
    "harnesses/detect.test.ts",
    "integration.test.ts",
  ]),
  // os.tmpdir has no Bun equivalent; tests only.
  "node:os": new Set([
    "commands/init.test.ts",
    "domain/lock.test.ts",
    "domain/packs.test.ts",
    "domain/vendor.test.ts",
    "harnesses/detect.test.ts",
    "integration.test.ts",
  ]),
  // node:crypto, node:readline, node:child_process, node:util, node:test:
  // deliberately absent — Bun.CryptoHasher / raw-stdin decoding / Bun.spawnSync
  // / cli/args.ts / bun:test replaced them. Absent means banned.
};

test("architecture: domain/ is pure — it imports nothing from cli/, commands/, or harnesses/", async () => {
  const modules = await loadModules();
  for (const mod of modules) {
    if (!mod.rel.startsWith("domain/")) continue;
    for (const spec of mod.imports) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(mod.rel), spec));
      expect(
        spec.startsWith(".") && /(^|\/)(cli|commands|harnesses)\//.test(resolved),
        `${mod.rel} imports ${spec} — domain/ must not depend on cli/, commands/, or harnesses/`,
      ).toBeFalsy();
    }
  }
});

test("architecture: only index.ts owns the process exit code", async () => {
  const modules = await loadModules();
  for (const mod of modules) {
    if (mod.rel === "index.ts" || isTest(mod.rel)) continue;
    expect(
      /process\.(exit|exitCode)\b/.test(mod.text),
      `${mod.rel} references process.exit/exitCode — commands return status; index.ts applies it`,
    ).toBeFalsy();
  }
});

test("architecture: only index.ts and cli/ui.ts write to stdout/stderr", async () => {
  const modules = await loadModules();
  const allowed = new Set(["index.ts", "cli/ui.ts"]);
  for (const mod of modules) {
    if (allowed.has(mod.rel) || isTest(mod.rel)) continue;
    expect(
      /console\.(log|error|warn|info)\(|process\.(stdout|stderr)\.write\(/.test(mod.text),
      `${mod.rel} writes to stdout/stderr — commands and domain return lines; index.ts prints`,
    ).toBeFalsy();
  }
});

test("architecture: node: imports stay inside the frozen allowlist", async () => {
  const modules = await loadModules();
  for (const mod of modules) {
    for (const spec of mod.imports) {
      if (!spec.startsWith("node:")) continue;
      const allowed = NODE_ALLOWLIST[spec];
      const ok = allowed === "test-and-source" || (allowed instanceof Set && allowed.has(mod.rel));
      expect(
        ok,
        `${mod.rel} imports ${spec}, which is not in the frozen node: allowlist — ` +
          "use the Bun-native API, or grow the allowlist WITH a ledger entry in ARCHITECTURE.md",
      ).toBeTruthy();
    }
  }
});
