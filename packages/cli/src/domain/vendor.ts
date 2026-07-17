/** File-copy primitives shared by init/add/remove/update: write-if-changed
 * (for idempotency) and recursive vendoring of a source tree, hashing each
 * file as it goes so callers can build lock.json without re-reading disk. */
import * as fs from "node:fs";
import * as path from "node:path";
import { sha256, toLockKey } from "./lock";
import type { WriteResult } from "./types";

const SKIP_NAMES = new Set([".gitkeep", "__pycache__"]);

/** True for filenames that are clearly a test/smoke-test companion rather
 * than the real entrypoint (e.g. `test_claude_compat.py`, `smoke-test.js`).
 * Used only for harness shims, which colocate implementation + test in one
 * flat directory — unlike packs (rules/ vs. rule-tests/) or the engine
 * (src/ vs. tests/), whose tests are already vendored deliberately. */
export function looksLikeTestFile(name: string): boolean {
  return /^test[-_]/i.test(name) || /[-_]test\.[^.]+$/i.test(name);
}

export interface VendorOptions {
  /** Filenames for which this returns true are skipped entirely. */
  exclude?: (name: string) => boolean;
}

/** Mirrors the source file's permission bits onto the copy. A vendored
 * entrypoint must stay executable — writeIfChanged alone drops the exec bit
 * and the wired hook dies with exit 126. Idempotent by nature. */
function mirrorMode(srcPath: string, destPath: string): void {
  fs.chmodSync(destPath, fs.statSync(srcPath).mode & 0o777);
}

/** Writes `content` to `filePath` only if it differs from what's already
 * there (byte comparison). Creates parent directories as needed. */
export function writeIfChanged(filePath: string, content: string | Buffer): WriteResult {
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  let prev: Buffer | null = null;
  try {
    prev = fs.readFileSync(filePath);
  } catch {
    prev = null;
  }
  if (prev !== null && prev.equals(next)) return "unchanged";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  return prev === null ? "created" : "updated";
}

export interface VendoredFile {
  /** Path relative to the destination root passed in, forward-slash normalized. */
  relPath: string;
  result: WriteResult;
  hash: string;
}

/** Recursively copies every file under `srcDir` into `destDir` (skipping
 * `.gitkeep` and `__pycache__`, plus anything `opts.exclude` matches),
 * preserving relative structure. */
export function vendorDir(srcDir: string, destDir: string, opts: VendorOptions = {}): VendoredFile[] {
  const results: VendoredFile[] = [];
  const walk = (srcSub: string, destSub: string) => {
    const entries = fs.readdirSync(srcSub, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name)) continue;
      if (opts.exclude?.(entry.name)) continue;
      const srcPath = path.join(srcSub, entry.name);
      const destPath = path.join(destSub, entry.name);
      if (entry.isDirectory()) {
        walk(srcPath, destPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(srcPath);
        const result = writeIfChanged(destPath, content);
        mirrorMode(srcPath, destPath);
        results.push({
          relPath: toLockKey(path.relative(destDir, destPath)),
          result,
          hash: sha256(content),
        });
      }
    }
  };
  walk(srcDir, destDir);
  return results;
}

/** Vendors a single source path (file or directory) into a destination
 * directory. Used for shims, whose exact shape (one file vs. a directory)
 * varies per harness. */
export function vendorInto(srcPath: string, destDir: string, opts: VendorOptions = {}): VendoredFile[] {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    return vendorDir(srcPath, destDir, opts);
  }
  if (opts.exclude?.(path.basename(srcPath))) return [];
  const destPath = path.join(destDir, path.basename(srcPath));
  const content = fs.readFileSync(srcPath);
  const result = writeIfChanged(destPath, content);
  mirrorMode(srcPath, destPath);
  return [{ relPath: toLockKey(path.basename(srcPath)), result, hash: sha256(content) }];
}

/** Removes a vendored directory entirely (used by `remove`). No-op if absent. */
export function removeVendored(destDir: string): void {
  fs.rmSync(destDir, { recursive: true, force: true });
}

export interface SourceFile {
  /** Forward-slash path relative to `srcDir`. */
  relPath: string;
  absPath: string;
}

/** Enumerates every file under `srcDir` (skipping `.gitkeep`/`__pycache__`)
 * WITHOUT copying anything — `update` needs to inspect each file before
 * deciding whether to overwrite it (see commands/update.ts). */
export function listSourceFiles(srcDir: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string, relBase: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) out.push({ relPath: rel, absPath: abs });
    }
  };
  walk(srcDir, "");
  return out;
}
