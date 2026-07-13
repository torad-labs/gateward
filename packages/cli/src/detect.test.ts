import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { detectHarnesses } from "./detect";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
}

test("detectHarnesses: nothing present reports all undetected", () => {
  const dir = tmpdir();
  try {
    const detections = detectHarnesses(dir);
    assert.deepEqual(
      detections.map((d) => d.detected),
      [false, false, false],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detectHarnesses: a .claude/settings.json signals Claude Code as detected", () => {
  const dir = tmpdir();
  try {
    fs.mkdirSync(path.join(dir, ".claude"));
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{}");
    const detections = detectHarnesses(dir);
    const claude = detections.find((d) => d.harness === "claude");
    assert.ok(claude?.detected);
    assert.ok(claude.signals.includes(".claude"));
    assert.ok(claude.signals.includes(".claude/settings.json"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detectHarnesses: a bare .opencode directory signals OpenCode as detected", () => {
  const dir = tmpdir();
  try {
    fs.mkdirSync(path.join(dir, ".opencode"));
    const detections = detectHarnesses(dir);
    const opencode = detections.find((d) => d.harness === "opencode");
    assert.ok(opencode?.detected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
