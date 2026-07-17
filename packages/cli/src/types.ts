/** Shared types used across the CLI's commands and utility modules. */

export interface RuleMeta {
  id: string;
  tier: string;
  /** From pack.yml's `default_enabled`; absent key means true. */
  defaultEnabled: boolean;
  summary?: string;
}

export interface PackMeta {
  id: string;
  title: string;
  /** The ast-grep language id (e.g. "kotlin", "typescript") every rule in
   * this pack targets. One pack, one language; `.tenets/config.toml`'s
   * `[core] languages` is derived from the enabled packs' languages. */
  language: string;
  /** Absolute path to this pack's source directory (under PACKS_ROOT). */
  dir: string;
  rules: RuleMeta[];
}

export type HarnessName = "claude" | "codex" | "opencode";

export interface HarnessDetection {
  harness: HarnessName;
  detected: boolean;
  /** Which paths (relative to the project root) triggered detection. */
  signals: string[];
}

export type WriteResult = "created" | "updated" | "unchanged";

/** The uniform result shape every command returns to index.ts: progress
 * lines to print and whether anything on disk changed. Commands never print
 * or exit themselves — index.ts owns stdout and the process exit code. */
export interface CommandOutcome {
  changed: boolean;
  lines: string[];
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  remedy?: string;
}

export interface LockFile {
  version: number;
  source: string;
  files: Record<string, string>;
}
