import { expect, test } from "bun:test";
import { renderTable } from "./ui";

test("renderTable: pads columns to the widest cell with a two-space gutter", () => {
  const text = renderTable([
    ["claude", "yes"],
    ["opencode", "no"],
  ]);
  expect(text).toBe("claude    yes\nopencode  no");
});

test("renderTable: empty input renders an empty string", () => {
  expect(renderTable([])).toBe("");
});

test("renderTable: trailing empty cells don't leave dangling whitespace", () => {
  const text = renderTable([["a", ""]]);
  expect(text).toBe("a");
});
