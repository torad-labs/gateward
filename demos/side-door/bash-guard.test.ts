import { expect, test } from "bun:test";
import { destinations, evaluateBash } from "./bash-guard";

test("destinations finds a mv target", () => {
  expect(destinations("mv /tmp/sneak.kt src/main/kotlin/Foo.kt")).toContain(
    "src/main/kotlin/Foo.kt",
  );
});

test("destinations finds a redirect target", () => {
  expect(destinations('cat scratch >> app/domain/Bar.kt')).toContain("app/domain/Bar.kt");
});

test("destinations finds a cp target with flags", () => {
  expect(destinations("cp -f a.kt b.kt")).toContain("b.kt");
});

test("destinations ignores a non-writing command", () => {
  expect(destinations("ls -la && grep foo bar.kt")).toEqual([]);
});

test("evaluateBash ignores non-Bash tools", async () => {
  expect(await evaluateBash({ tool_name: "Write", tool_input: { command: "mv a b" } })).toBeNull();
});

test("evaluateBash allows a mv whose destination is not gated", async () => {
  // /tmp has no .tenets project above it in the test env → not gated.
  expect(
    await evaluateBash({ tool_name: "Bash", tool_input: { command: "mv /tmp/a.kt /tmp/b.kt" } }),
  ).toBeNull();
});

test("evaluateBash blocks a mv into the golden app's gated tree", async () => {
  const dest =
    "apps/golden/feature/favorites/domain/src/main/kotlin/com/torad/openhouse/feature/favorites/domain/Sneak.kt";
  const verdict = await evaluateBash({
    tool_name: "Bash",
    tool_input: { command: `mv /tmp/sneak.kt ${dest}` },
  });
  expect(verdict?.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(verdict?.hookSpecificOutput.permissionDecisionReason).toContain("gated path");
  expect(verdict?.hookSpecificOutput.permissionDecisionReason).toContain("Write the file directly");
});
