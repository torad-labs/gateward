import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { hasCoreAndPacksSections } from "../configToml";
import { detectHarnesses } from "../detect";
import { readLock, sha256File } from "../lock";
import { CLAUDE_HOOK_MARKER } from "../merge";
import { SHIMS_ROOT, configTomlPath, tenetsDir } from "../paths";
import type { DoctorCheck, HarnessDetection } from "../types";

function python3Remedy(): string {
  switch (process.platform) {
    case "darwin":
      return "brew install python3";
    case "win32":
      return "winget install Python.Python.3 (or https://www.python.org/downloads/)";
    default:
      return "sudo apt install python3 (Debian/Ubuntu), or your distro's equivalent package manager";
  }
}

function checkBinary(name: string, args: string[], remedy: string): DoctorCheck {
  let result;
  try {
    result = spawnSync(name, args, { stdio: "pipe" });
  } catch {
    result = null;
  }
  if (!result || result.error || result.status !== 0) {
    return { name, status: "fail", message: `${name} not found on PATH.`, remedy };
  }
  const versionText = (result.stdout?.toString().trim() || result.stderr?.toString().trim() || `${name} found`);
  return { name, status: "pass", message: versionText };
}

function checkTenetsConfig(root: string): DoctorCheck {
  const configPath = configTomlPath(root);
  if (!fs.existsSync(configPath)) {
    return {
      name: "tenets-config",
      status: "fail",
      message: ".tenets/config.toml not found.",
      remedy: "run `portable-hooks init`",
    };
  }
  const text = fs.readFileSync(configPath, "utf8");
  if (!hasCoreAndPacksSections(text)) {
    return {
      name: "tenets-config",
      status: "fail",
      message: ".tenets/config.toml is missing a [core] or [packs] section.",
      remedy: "run `portable-hooks init` again, or restore config.toml",
    };
  }
  return { name: "tenets-config", status: "pass", message: ".tenets/config.toml present and structurally valid." };
}

function checkLockDrift(root: string): DoctorCheck {
  const tDir = tenetsDir(root);
  const lock = readLock(tDir);
  if (!lock) {
    return { name: "lock-drift", status: "fail", message: ".tenets/lock.json not found.", remedy: "run `portable-hooks init`" };
  }
  const drifted: string[] = [];
  for (const [key, expectedHash] of Object.entries(lock.files)) {
    const filePath = path.join(tDir, ...key.split("/"));
    if (!fs.existsSync(filePath)) {
      drifted.push(`${key} (missing)`);
      continue;
    }
    if (sha256File(filePath) !== expectedHash) drifted.push(key);
  }
  if (drifted.length > 0) {
    return {
      name: "lock-drift",
      status: "warn",
      message: `${drifted.length} vendored file(s) modified: ${drifted.join(", ")}`,
      remedy: "local edits preserved; run update to see diffs",
    };
  }
  return {
    name: "lock-drift",
    status: "pass",
    message: `${Object.keys(lock.files).length} vendored file(s), no drift.`,
  };
}

function checkClaudeWiring(root: string): DoctorCheck {
  const settingsPath = path.join(root, ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) {
    return {
      name: "harness:claude",
      status: "fail",
      message: ".claude/ detected but settings.json is missing.",
      remedy: "run `portable-hooks init`",
    };
  }
  const text = fs.readFileSync(settingsPath, "utf8");
  if (text.includes(CLAUDE_HOOK_MARKER)) {
    return { name: "harness:claude", status: "pass", message: "Claude Code PreToolUse hook wired." };
  }
  return {
    name: "harness:claude",
    status: "fail",
    message: "Claude Code detected but the PreToolUse hook is not wired.",
    remedy: "run `portable-hooks init`",
  };
}

function checkCodexWiring(root: string): DoctorCheck {
  if (!fs.existsSync(path.join(SHIMS_ROOT, "codex"))) {
    return {
      name: "harness:codex",
      status: "warn",
      message: "Codex detected, but portable-hooks has no Codex shim yet.",
      remedy: "upgrade portable-hooks once the Codex shim ships; not fixable today",
    };
  }
  const hooksPath = path.join(root, ".codex", "hooks.json");
  if (!fs.existsSync(hooksPath) || !fs.readFileSync(hooksPath, "utf8").includes(".tenets/engine/shims/codex/")) {
    return {
      name: "harness:codex",
      status: "fail",
      message: "Codex detected but not wired.",
      remedy: "run `portable-hooks init`",
    };
  }
  return { name: "harness:codex", status: "pass", message: "Codex hook wired." };
}

function checkOpencodeWiring(root: string): DoctorCheck {
  if (!fs.existsSync(path.join(SHIMS_ROOT, "opencode"))) {
    return {
      name: "harness:opencode",
      status: "warn",
      message: "OpenCode detected, but portable-hooks has no OpenCode plugin yet.",
      remedy: "upgrade portable-hooks once the OpenCode plugin ships; not fixable today",
    };
  }
  const pluginsDir = path.join(root, ".opencode", "plugins");
  if (!fs.existsSync(pluginsDir) || fs.readdirSync(pluginsDir).length === 0) {
    return {
      name: "harness:opencode",
      status: "fail",
      message: "OpenCode detected but the plugin is not installed.",
      remedy: "run `portable-hooks init`",
    };
  }
  return { name: "harness:opencode", status: "pass", message: "OpenCode plugin installed." };
}

function checkHarnessWiring(root: string, detection: HarnessDetection): DoctorCheck {
  if (detection.harness === "claude") return checkClaudeWiring(root);
  if (detection.harness === "codex") return checkCodexWiring(root);
  return checkOpencodeWiring(root);
}

export function runDoctor(root: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    checkBinary("python3", ["--version"], python3Remedy()),
    checkBinary("ast-grep", ["--version"], "npm i -g @ast-grep/cli"),
    checkTenetsConfig(root),
    checkLockDrift(root),
  ];
  for (const detection of detectHarnesses(root)) {
    if (detection.detected) checks.push(checkHarnessWiring(root, detection));
  }
  return checks;
}
