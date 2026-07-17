/**
 * Valibot schemas for the JSON boundaries the CLI reads — the "parse, don't
 * validate" edge. Untrusted or hand-editable bytes come in exactly here;
 * everything past a successful parse carries a trusted type with no `as` casts.
 *
 * Kernel-level (imported by domain and by paths): pure schemas, no I/O, no
 * dependency but valibot itself. This module is the reason the CLI carries
 * its one runtime dependency. The ENGINE takes no dependencies at all — it is
 * vendored into target projects without node_modules (see ARCHITECTURE.md's
 * ledger) — so these schemas deliberately live CLI-side only.
 *
 * The harness settings/hooks JSON (Claude settings.json, Codex hooks.json)
 * is intentionally NOT schema'd: those files are merge-not-clobber
 * round-trips of arbitrary user JSON, where the contract is "touch nothing
 * you don't understand" — hand narrowing in harnesses/settingsMerge.ts is
 * the right tool there, and a schema would invite stripping unknown keys.
 */
import * as v from "valibot";

/** `.tenets/lock.json`: version, source stamp, and path -> sha256 map. A
 * user can hand-edit or corrupt this file, so it is a real boundary. */
export const LockFileSchema = v.object({
  version: v.number(),
  source: v.string(),
  files: v.record(v.string(), v.string()),
});

export type LockFileShape = v.InferOutput<typeof LockFileSchema>;

/** The one field the CLI reads from its own package.json (to stamp
 * lock.json's source). A missing/blank version means a corrupt install. */
export const PackageVersionSchema = v.object({
  version: v.pipe(v.string(), v.nonEmpty()),
});

/** Parses an unknown JSON value against a schema; null on any mismatch —
 * for boundaries whose contract is "unreadable means absent" (lock.json). */
export function parseOrNull<TSchema extends v.GenericSchema>(
  schema: TSchema,
  data: unknown,
): v.InferOutput<TSchema> | null {
  const result = v.safeParse(schema, data);
  return result.success ? result.output : null;
}
