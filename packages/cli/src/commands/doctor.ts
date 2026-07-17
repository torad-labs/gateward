import * as path from "node:path";
import { readLock, sha256File } from "../domain/lock";
import { hasCoreAndPacksSections } from "../domain/tenetsConfig";
import { detectHarnesses, HARNESSES } from "../harnesses";
import { configTomlPath, tenetsDir } from "../paths";
import type { DoctorCheck } from "../types";

function checkBinary(name: string, args: string[], remedy: string): DoctorCheck {
  let result: ReturnType<typeof Bun.spawnSync> | null;
  try {
    result = Bun.spawnSync({ cmd: [name, ...args] });
  } catch {
    result = null;
  }
  if (result?.exitCode !== 0) {
    return { name, status: "fail", message: `${name} not found on PATH.`, remedy };
  }
  const versionText = result.stdout?.toString().trim() || result.stderr?.toString().trim() || `${name} found`;
  return { name, status: "pass", message: versionText };
}

async function checkTenetsConfig(root: string): Promise<DoctorCheck> {
  const configFile = Bun.file(configTomlPath(root));
  if (!(await configFile.exists())) {
    return {
      name: "tenets-config",
      status: "fail",
      message: ".tenets/config.toml not found.",
      remedy: "run `portable-hooks init`",
    };
  }
  const text = await configFile.text();
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

async function checkLockDrift(root: string): Promise<DoctorCheck> {
  const tDir = tenetsDir(root);
  const lock = await readLock(tDir);
  if (!lock) {
    return {
      name: "lock-drift",
      status: "fail",
      message: ".tenets/lock.json not found.",
      remedy: "run `portable-hooks init`",
    };
  }
  const drifted: string[] = [];
  for (const [key, expectedHash] of Object.entries(lock.files)) {
    const filePath = path.join(tDir, ...key.split("/"));
    if (!(await Bun.file(filePath).exists())) {
      drifted.push(`${key} (missing)`);
      continue;
    }
    if ((await sha256File(filePath)) !== expectedHash) drifted.push(key);
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

export async function runDoctor(root: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    checkBinary(
      "ast-grep",
      ["--version"],
      "bun add -g @ast-grep/cli (or npm i -g @ast-grep/cli, or brew install ast-grep)",
    ),
    await checkTenetsConfig(root),
    await checkLockDrift(root),
  ];
  for (const detection of detectHarnesses(root)) {
    if (!detection.detected) continue;
    const adapter = HARNESSES.find((a) => a.id === detection.harness);
    if (adapter) checks.push(await adapter.check(root));
  }
  return checks;
}
