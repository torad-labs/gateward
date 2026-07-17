/** File-copy primitives shared by init/add/remove/update: write-if-changed
 * (for idempotency) and recursive vendoring of a source tree, hashing each
 * file as it goes so callers can build lock.json without re-reading disk.
 * `node:fs` here is structural-only (stat/chmod for permission mirroring) —
 * content I/O is Bun.file/Bun.write, which auto-creates parent directories. */
import * as fs from "node:fs";
import * as path from "node:path";
import type { WriteResult } from "../types";
import { sha256, toLockKey } from "./lock";

const SKIP_NAMES = new Set([".gitkeep"]);

/** A name starting with `test-`/`test_` (case-insensitive). */
const TEST_PREFIX_RE = /^test[-_]/i;
/** A name ending in `-test.<ext>`/`_test.<ext>` (case-insensitive). */
const TEST_SUFFIX_RE = /[-_]test\.[^.]+$/i;

/** True for filenames that are clearly a test/smoke-test companion rather
 * than the real entrypoint (e.g. `test_claude_compat.py`, `smoke-test.js`).
 * Used only for harness shims, which colocate implementation + test in one
 * flat directory — unlike packs (rules/ vs. rule-tests/) or the engine
 * (src/ vs. tests/), whose tests are already vendored deliberately. */
export function looksLikeTestFile(name: string): boolean {
  return TEST_PREFIX_RE.test(name) || TEST_SUFFIX_RE.test(name);
}

export interface VendorOptions {
  /** Filenames for which this returns true are skipped entirely. */
  exclude?: (name: string) => boolean;
}

/** Mirrors the source file's permission bits onto the copy. A vendored
 * entrypoint must stay executable — writeIfChanged alone drops the exec bit
 * and the wired hook dies with exit 126. Idempotent by nature. */
function mirrorMode(srcPath: string, destPath: string): void {
  // biome-ignore lint/suspicious/noBitwiseOperators: POSIX permission mask
  fs.chmodSync(destPath, fs.statSync(srcPath).mode & 0o777);
}

/** Writes `content` to `filePath` only if it differs from what's already
 * there (byte comparison). Bun.write creates parent directories as needed. */
export async function writeIfChanged(filePath: string, content: string | Uint8Array): Promise<WriteResult> {
  const next: Uint8Array = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const file = Bun.file(filePath);
  let prev: Uint8Array | null = null;
  if (await file.exists()) {
    prev = await file.bytes();
  }
  if (prev !== null && prev.length === next.length && Buffer.compare(prev, next) === 0) return "unchanged";
  await Bun.write(file, next);
  return prev === null ? "created" : "updated";
}

export interface VendoredFile {
  /** Path relative to the destination root passed in, forward-slash normalized. */
  relPath: string;
  result: WriteResult;
  hash: string;
}

/** Every non-skipped file under `srcDir`, as forward-slash relative paths,
 * sorted for deterministic vendoring order. */
async function scanTree(srcDir: string, opts: VendorOptions = {}): Promise<string[]> {
  const rels: string[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const rel of glob.scan({ cwd: srcDir, onlyFiles: true, dot: false })) {
    const parts = rel.split(path.sep);
    if (parts.some((part) => SKIP_NAMES.has(part))) continue;
    const lastPart = parts.at(-1);
    if (lastPart !== undefined && opts.exclude?.(lastPart)) continue;
    rels.push(parts.join("/"));
  }
  return rels.sort();
}

/** Recursively copies every file under `srcDir` into `destDir` (skipping
 * `.gitkeep` and `__pycache__`, plus anything `opts.exclude` matches),
 * preserving relative structure. */
export async function vendorDir(srcDir: string, destDir: string, opts: VendorOptions = {}): Promise<VendoredFile[]> {
  const results: VendoredFile[] = [];
  for (const rel of await scanTree(srcDir, opts)) {
    const srcPath = path.join(srcDir, ...rel.split("/"));
    const destPath = path.join(destDir, ...rel.split("/"));
    // biome-ignore lint/performance/noAwaitInLoops: sequential so `results` (which becomes lock.json's file order) matches scanTree's sorted order
    const content = await Bun.file(srcPath).bytes();
    const result = await writeIfChanged(destPath, content);
    mirrorMode(srcPath, destPath);
    results.push({ relPath: rel, result, hash: sha256(content) });
  }
  return results;
}

/** Vendors a single source path (file or directory) into a destination
 * directory. Used for shims, whose exact shape (one file vs. a directory)
 * varies per harness. */
export async function vendorInto(srcPath: string, destDir: string, opts: VendorOptions = {}): Promise<VendoredFile[]> {
  if (fs.statSync(srcPath).isDirectory()) {
    return vendorDir(srcPath, destDir, opts);
  }
  if (opts.exclude?.(path.basename(srcPath))) return [];
  const destPath = path.join(destDir, path.basename(srcPath));
  const content = await Bun.file(srcPath).bytes();
  const result = await writeIfChanged(destPath, content);
  mirrorMode(srcPath, destPath);
  return [{ relPath: toLockKey(path.basename(srcPath)), result, hash: sha256(content) }];
}

/** Removes a vendored directory entirely (used by `remove`). No-op if absent. */
export async function removeVendored(destDir: string): Promise<void> {
  await Bun.$`rm -rf ${destDir}`.quiet();
}

export interface SourceFile {
  /** Forward-slash path relative to `srcDir`. */
  relPath: string;
  absPath: string;
}

/** Enumerates every file under `srcDir` (skipping `.gitkeep`/`__pycache__`)
 * WITHOUT copying anything — `update` needs to inspect each file before
 * deciding whether to overwrite it (see commands/update.ts). */
export async function listSourceFiles(srcDir: string): Promise<SourceFile[]> {
  const rels = await scanTree(srcDir);
  return rels.map((relPath) => ({ relPath, absPath: path.join(srcDir, ...relPath.split("/")) }));
}
