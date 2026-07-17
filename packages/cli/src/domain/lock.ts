/** sha256 content hashing and `.tenets/lock.json` read/write/build. */
import * as path from "node:path";
import type { LockFile } from "../types";

export const LOCK_VERSION = 1;
export const LOCK_FILENAME = "lock.json";

export function sha256(content: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256(await Bun.file(filePath).bytes());
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
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function lockPath(tenetsDir: string): string {
  return path.join(tenetsDir, LOCK_FILENAME);
}

export async function readLock(tenetsDir: string): Promise<LockFile | null> {
  const file = Bun.file(lockPath(tenetsDir));
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as LockFile;
  } catch {
    return null;
  }
}
