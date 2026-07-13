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
