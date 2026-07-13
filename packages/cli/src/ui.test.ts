import * as assert from "node:assert/strict";
import { test } from "node:test";
import { renderTable } from "./ui";

test("renderTable: pads columns to the widest cell with a two-space gutter", () => {
  const text = renderTable([
    ["claude", "yes"],
    ["opencode", "no"],
  ]);
  assert.equal(text, "claude    yes\nopencode  no");
});

test("renderTable: empty input renders an empty string", () => {
  assert.equal(renderTable([]), "");
});

test("renderTable: trailing empty cells don't leave dangling whitespace", () => {
  const text = renderTable([["a", ""]]);
  assert.equal(text, "a");
});
