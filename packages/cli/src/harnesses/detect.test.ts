import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectHarnesses } from "./index";

async function tmpdir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `detect-test-${crypto.randomUUID()}`);
  await Bun.$`mkdir -p ${dir}`.quiet();
  return dir;
}

test("detectHarnesses: nothing present reports all undetected", async () => {
  const dir = await tmpdir();
  try {
    const detections = detectHarnesses(dir);
    expect(detections.map((d) => d.detected)).toEqual([false, false, false, false]);
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});

test("detectHarnesses: a .claude/settings.json signals Claude Code as detected", async () => {
  const dir = await tmpdir();
  try {
    fs.mkdirSync(path.join(dir, ".claude"));
    await Bun.write(path.join(dir, ".claude", "settings.json"), "{}");
    const detections = detectHarnesses(dir);
    const claude = detections.find((d) => d.harness === "claude");
    if (!claude?.detected) throw new Error("claude detection should exist and be detected");
    expect(claude.signals.includes(".claude")).toBeTruthy();
    expect(claude.signals.includes(".claude/settings.json")).toBeTruthy();
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});

test("detectHarnesses: a bare .opencode directory signals OpenCode as detected", async () => {
  const dir = await tmpdir();
  try {
    fs.mkdirSync(path.join(dir, ".opencode"));
    const detections = detectHarnesses(dir);
    const opencode = detections.find((d) => d.harness === "opencode");
    expect(opencode?.detected).toBeTruthy();
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});

test("detectHarnesses: a .github/copilot-instructions.md signals Copilot as detected", async () => {
  const dir = await tmpdir();
  try {
    fs.mkdirSync(path.join(dir, ".github"));
    await Bun.write(path.join(dir, ".github", "copilot-instructions.md"), "# instructions\n");
    const detections = detectHarnesses(dir);
    const copilot = detections.find((d) => d.harness === "copilot");
    if (!copilot?.detected) throw new Error("copilot detection should exist and be detected");
    expect(copilot.signals).toEqual([".github/copilot-instructions.md"]);
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
});
