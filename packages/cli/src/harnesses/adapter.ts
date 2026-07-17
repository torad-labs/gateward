/**
 * The harness seam. Each supported coding-agent harness (Claude Code, Codex,
 * OpenCode) is one adapter implementing this interface; the registry in
 * `./index.ts` is the only place that enumerates them. Adding a harness is
 * adding one adapter file and registering it — nothing in commands/ changes.
 */
import type { DoctorCheck, HarnessName } from "../types";

export interface WireContext {
  /** The target project root (where `.tenets/` lives). */
  root: string;
}

export interface WireReport {
  /** Human-readable progress lines for the command output. */
  lines: string[];
  /** Vendored-file hash entries to fold into `.tenets/lock.json`, keyed by
   * lock key (e.g. `engine/shims/codex/claude_compat.ts`). */
  lockEntries: Record<string, string>;
  changed: boolean;
}

export interface HarnessAdapter {
  readonly id: HarnessName;
  /** Paths relative to the project root whose presence signals this harness.
   * Detection is purely informational (reported to the user); it does not
   * gate whether `init` wires a harness — see commands/init.ts. */
  readonly signals: string[];
  /** Vendors whatever this harness needs and wires its hook config. Called
   * unconditionally by `init` (wiring is idempotent and merge-not-clobber). */
  wire(ctx: WireContext): Promise<WireReport>;
  /** Doctor's wiring check, run only when this harness was detected. */
  check(root: string): Promise<DoctorCheck>;
}
