/** GitHub Copilot adapter: vendors the Copilot shim next to the engine and
 * writes `.github/hooks/portable-hooks.json`. Copilot (the CLI, the cloud
 * coding agent, and VS Code agent mode) reads `preToolUse` command hooks from
 * `.github/hooks/*.json` — a directory of per-purpose files, so unlike
 * Claude's shared settings.json there is nothing to merge into: the file is
 * ours by name and is generated whole. Only wired when packages/shims/copilot
 * exists in source at the moment init runs (checked fresh every run, never
 * hardcoded — mirrors the Codex adapter). `node:fs` here is structural-only
 * (directory existence). */
import * as fs from "node:fs";
import * as path from "node:path";
import { looksLikeTestFile, vendorInto, writeIfChanged } from "../domain/vendor";
import { engineDestDir, SHIMS_ROOT } from "../paths";
import type { DoctorCheck } from "../types";
import type { HarnessAdapter, WireContext, WireReport } from "./adapter";

export const COPILOT_HOOK_MARKER = ".tenets/engine/shims/copilot/entry.ts";

/**
 * The full `.github/hooks/portable-hooks.json` this adapter writes.
 *
 * The matcher covers Copilot CLI's native file tools (`create`, `edit`) AND
 * the Claude-compat names (`Write`, `Edit`) VS Code's hook bridge may emit —
 * matching the tool the harness actually calls is what makes the gate run at
 * all (the same reasoning as the Codex adapter's `apply_patch` matcher). The
 * shim silently allows anything it does not gate, so the wider matcher
 * cannot over-block.
 *
 * `timeoutSec` is a security parameter with Copilot's documented asymmetry:
 * a crashed preToolUse hook fails closed (deny), but a TIMED-OUT one fails
 * OPEN — the write proceeds as if the hook never ran. 60s keeps comfortable
 * headroom over the shim's internal engine budget (30s), so a hung engine
 * surfaces as the shim's own explicit deny before Copilot's ceiling can wave
 * the write through.
 *
 * Both `bash` and `powershell` carry the same command (bun is the
 * interpreter either way); repo-level hooks run with `cwd` pinned to the
 * project root, where the vendored `.tenets/` path resolves.
 */
export function copilotHooksFileText(): string {
  const config = {
    version: 1,
    hooks: {
      preToolUse: [
        {
          type: "command",
          bash: `bun ${COPILOT_HOOK_MARKER}`,
          powershell: `bun ${COPILOT_HOOK_MARKER}`,
          cwd: ".",
          timeoutSec: 60,
          matcher: "create|edit|Write|Edit",
        },
      ],
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function wire({ root }: WireContext): Promise<WireReport> {
  const shimSrc = path.join(SHIMS_ROOT, "copilot");
  if (!fs.existsSync(shimSrc)) {
    return { lines: ["copilot: engine shim not present in source, skipped"], lockEntries: {}, changed: false };
  }
  const lockEntries: Record<string, string> = {};
  let changed = false;
  const dest = path.join(engineDestDir(root), "shims", "copilot");
  const shimResults = await vendorInto(shimSrc, dest, { exclude: looksLikeTestFile });
  for (const r of shimResults) {
    lockEntries[`engine/shims/copilot/${r.relPath}`] = r.hash;
    if (r.result !== "unchanged") changed = true;
  }
  const hooksPath = path.join(root, ".github", "hooks", "portable-hooks.json");
  const result = await writeIfChanged(hooksPath, copilotHooksFileText());
  if (result !== "unchanged") changed = true;
  return {
    lines: [
      `Copilot wired -> .github/hooks/portable-hooks.json (${result === "unchanged" ? "already wired" : "added hook"})`,
    ],
    lockEntries,
    changed,
  };
}

async function check(root: string): Promise<DoctorCheck> {
  if (!fs.existsSync(path.join(SHIMS_ROOT, "copilot"))) {
    return {
      name: "harness:copilot",
      status: "warn",
      message: "Copilot detected, but portable-hooks has no Copilot shim yet.",
      remedy: "upgrade portable-hooks once the Copilot shim ships; not fixable today",
    };
  }
  const hooksFile = Bun.file(path.join(root, ".github", "hooks", "portable-hooks.json"));
  const wired = (await hooksFile.exists()) && (await hooksFile.text()).includes(COPILOT_HOOK_MARKER);
  if (!wired) {
    return {
      name: "harness:copilot",
      status: "fail",
      message: "Copilot detected but not wired.",
      remedy: "run `portable-hooks init`",
    };
  }
  return { name: "harness:copilot", status: "pass", message: "Copilot preToolUse hook wired." };
}

export const copilotAdapter: HarnessAdapter = {
  id: "copilot",
  signals: [".github/copilot-instructions.md", ".github/hooks", ".github/copilot"],
  wire,
  check,
};
