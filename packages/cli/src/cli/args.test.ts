import { expect, test } from "bun:test";
import { parseFlags } from "./args";
import { CliError } from "./errors";

test("parseFlags: string flag accepts both '--flag value' and '--flag=value'", () => {
  const spaced = parseFlags(["--packs", "all"], { flags: { packs: { type: "string" } } });
  expect(spaced.values.packs).toBe("all");
  const inline = parseFlags(["--packs=a,b"], { flags: { packs: { type: "string" } } });
  expect(inline.values.packs).toBe("a,b");
});

test("parseFlags: boolean long flag and its short alias both set true", () => {
  const spec = { flags: { yes: { type: "boolean" as const, short: "y" } } };
  expect(parseFlags(["--yes"], spec).values.yes).toBe(true);
  expect(parseFlags(["-y"], spec).values.yes).toBe(true);
  expect(parseFlags([], spec).values.yes).toBeUndefined();
});

test("parseFlags: unknown option is a usage error (exit code 2)", () => {
  try {
    parseFlags(["--nope"], {});
    throw new Error("expected a CliError");
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    expect(err.exitCode).toBe(2);
    expect(err.message).toMatch(/--nope/);
  }
});

test("parseFlags: a string flag with no value is a usage error", () => {
  expect(() => parseFlags(["--packs"], { flags: { packs: { type: "string" } } })).toThrow(/requires a value/);
});

test("parseFlags: a value on a boolean flag is a usage error", () => {
  expect(() => parseFlags(["--yes=1"], { flags: { yes: { type: "boolean" } } })).toThrow(/does not take a value/);
});

test("parseFlags: positionals are rejected unless allowed, collected when allowed", () => {
  expect(() => parseFlags(["stray"], {})).toThrow(/Unexpected argument 'stray'/);
  const allowed = parseFlags(["one", "two"], { allowPositionals: true });
  expect(allowed.positionals).toEqual(["one", "two"]);
});

test("parseFlags: '--' ends flag parsing; later dashed args become positionals", () => {
  const parsed = parseFlags(["--", "--not-a-flag"], { allowPositionals: true });
  expect(parsed.positionals).toEqual(["--not-a-flag"]);
});
