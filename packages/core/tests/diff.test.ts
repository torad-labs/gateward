/** Unit tests for the only-new-violations multiset diff. */
import { expect, test } from "bun:test";
import { newViolations } from "../src/diff";
import type { Match } from "../src/scan";

function match(ruleId: string, text: string): Match {
  return { ruleId, message: "m", text, severity: "error", line: 1, tier: "deny" };
}

test("new file: every finding is new", () => {
  const projected = [match("no-force-unwrap", "a!!")];
  const fresh = newViolations([], projected);
  expect(fresh.map((m) => m.text)).toEqual(["a!!"]);
});

test("unchanged findings do not block", () => {
  const current = [match("no-force-unwrap", "a!!")];
  const projected = [match("no-force-unwrap", "a!!")];
  expect(newViolations(current, projected)).toEqual([]);
});

test("an edit adding one distinct violation surfaces exactly it", () => {
  const current = [match("no-force-unwrap", "a!!"), match("no-force-unwrap", "b!!")];
  const projected = [...current, match("no-force-unwrap", "c!!")];
  const fresh = newViolations(current, projected);
  expect(fresh.map((m) => m.text)).toEqual(["c!!"]);
});

test("multiset counts: a repeated identical text is new", () => {
  const current = [match("no-force-unwrap", "x!!")];
  const projected = [match("no-force-unwrap", "x!!"), match("no-force-unwrap", "x!!")];
  const fresh = newViolations(current, projected);
  expect(fresh.length).toBe(1);
  const [first] = fresh;
  if (first === undefined) throw new Error("expected a finding");
  expect(first.text).toBe("x!!");
});

test("removing a legacy violation yields nothing new", () => {
  const current = [match("no-force-unwrap", "a!!"), match("no-force-unwrap", "b!!")];
  const projected = [match("no-force-unwrap", "a!!")];
  expect(newViolations(current, projected)).toEqual([]);
});

test("same text under a different rule is a distinct key", () => {
  const current = [match("rule-a", "token")];
  const projected = [match("rule-a", "token"), match("rule-b", "token")];
  const fresh = newViolations(current, projected);
  expect(fresh.map((m) => [m.ruleId, m.text])).toEqual([["rule-b", "token"]]);
});
