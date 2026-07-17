import { expect, test } from "bun:test";
import { extractBlocks } from "./extract_blocks";

function record(obj: unknown): string {
  return JSON.stringify(obj);
}

test("pulls a rule block out of a toolUseResult Error string", () => {
  const raw = record({
    toolUseResult:
      "Error: [no-event-bus] line 43: Event buses hide who-changed-what — use a Flow.",
  });
  expect(extractBlocks(raw)).toEqual([
    "[no-event-bus] line 43: Event buses hide who-changed-what — use a Flow.",
  ]);
});

test("de-duplicates the same block seen in result and message content", () => {
  const msg = "[no-context-in-domain] line 9: drop this Context parameter.";
  const raw = [
    record({ toolUseResult: `Error: ${msg}` }),
    record({ message: { content: [{ content: msg }] } }),
  ].join("\n");
  expect(extractBlocks(raw)).toEqual([msg]);
});

test("ignores lines that are not rule blocks", () => {
  const raw = [
    record({ toolUseResult: "Read 19 lines" }),
    "not json at all",
    record({ message: { content: [{ content: "just a normal assistant sentence" }] } }),
  ].join("\n");
  expect(extractBlocks(raw)).toEqual([]);
});
