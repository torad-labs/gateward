/** sha256 content hashing and `.tenets/lock.json` read/write/build. */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LockFile } from "./types";

export const LOCK_VERSION = 1;
export const LOCK_FILENAME = "lock.json";

export function sha256(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function sha256File(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

/** Normalizes a filesystem-relative path to the forward-slash form lock.json keys use. */
export function toLockKey(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

/** Builds a lock file, hash keys sorted for a deterministic, diff-stable serialization. */
export function buildLock(source: string, files: Record<string, string>): LockFile {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(files).sort()) sorted[key] = files[key];
  return { version: LOCK_VERSION, source, files: sorted };
}

export function serializeLock(lock: LockFile): string {
  return JSON.stringify(lock, null, 2) + "\n";
}

export function lockPath(tenetsDir: string): string {
  return path.join(tenetsDir, LOCK_FILENAME);
}

export function readLock(tenetsDir: string): LockFile | null {
  const p = lockPath(tenetsDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as LockFile;
  } catch {
    return null;
  }
}
