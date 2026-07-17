/**
 * Reads `.tenets/config.toml` — the installed, per-project gate configuration.
 *
 * The core is zero-dependency: TOML parsing is Bun's native `.toml` import
 * (import-with-attribute), so the engine carries no third-party dependency
 * and no hand-rolled parser. It never parses rule YAML — ast-grep owns rule
 * semantics.
 *
 * Schema (minimal by design):
 *
 *     [core]
 *     languages    = ["kotlin"]      # which languages this project gates
 *     default_tier = "deny"          # tier for any rule not listed below
 *
 *     [packs]
 *     packs_dir = "../../../packs"          # rule-packs root. A relative path
 *     enabled   = ["kotlin-best-practices"] #   resolves from THIS file's directory.
 *
 *     # Optional per-rule tables. `tier` overrides default_tier for one rule;
 *     # `enabled` forces it on or off. A rule's default tier is authored
 *     # upstream in its pack's pack.yml; the installer reflects the ones worth
 *     # changing into this file so the core never has to read rule YAML.
 *     [rules.no-assert-equals-boolean]
 *     tier = "autofix"
 *
 * The language-to-extension mapping lives in code (LANGUAGE_EXTENSIONS): the
 * config names languages, the core knows their file extensions. Tier is
 * resolved here because ast-grep's scan JSON does not surface rule metadata.
 *
 * A pack's `pack.yml` may mark a rule `default_enabled: false` (house-taste
 * opinions a project must opt into). `pack.yml` is a small, self-authored
 * manifest, not rule YAML, so reading its `rules:` list stays consistent with
 * "the core never parses rule YAML": `packRuleDefaults` does a narrow,
 * line-oriented scan of that one list, and `Config.ruleEnabled` only falls
 * back to it when `.tenets/config.toml` has no explicit `enabled` for the rule.
 *
 * Note on caching: the native TOML import caches per absolute path for the
 * process lifetime. The hook and the audit are one-shot processes, so this is
 * irrelevant at runtime; tests must use a fresh path per distinct content.
 *
 * Note on a Bun/tomllib divergence: Bun's native TOML parser rejects
 * digit-leading bare keys (e.g. `[rules.123-x]`) that Python's tomllib would
 * accept. This is not worked around here — the CLI's rule-id allowlist
 * (`^[a-z][a-z0-9-]*$`) already prevents any digit-leading id from being
 * generated in practice, and a hand-crafted config with one simply throws,
 * which the hook's caller turns into a fail-closed deny (see
 * events/pretooluse.ts's top-level error handling).
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Splits pack.yml text into lines, tolerating CRLF line endings. */
const PACK_YML_LINE_SPLIT_RE = /\r?\n/;
/** A line with leading whitespace (still inside an indented block). */
const INDENTED_LINE_RE = /^\s/;

const TENETS_DIRNAME = ".tenets";
const CONFIG_FILENAME = "config.toml";

const TIER_DENY = "deny";
export const TIER_AUTOFIX = "autofix";

/** Extensions gated for each language the packs support. */
const LANGUAGE_EXTENSIONS: Record<string, readonly string[]> = {
  kotlin: [".kt", ".kts"],
  typescript: [".ts", ".mts", ".cts"],
};

interface RuleOverride {
  tier?: string;
  enabled?: boolean;
}

interface ConfigToml {
  core?: { languages?: string[]; default_tier?: string };
  packs?: { packs_dir?: string; enabled?: string[] };
  rules?: Record<string, RuleOverride>;
}

/** A resolved `.tenets/config.toml`. */
export class Config {
  // biome-ignore lint/complexity/useMaxParams: constructor parameter properties are the house idiom for immutable value holders (see biome.jsonc) — one field per resolved config value
  constructor(
    readonly configDir: string,
    readonly languages: readonly string[],
    readonly defaultTier: string,
    readonly packsDir: string,
    readonly enabledPacks: readonly string[],
    readonly ruleOverrides: Record<string, RuleOverride>,
    readonly packRuleDefaults: Record<string, boolean>,
  ) {}

  get gatedExtensions(): Set<string> {
    const extensions = new Set<string>();
    for (const language of this.languages) {
      for (const ext of LANGUAGE_EXTENSIONS[language] ?? []) extensions.add(ext);
    }
    return extensions;
  }

  /** True when this project gates the given file's type. Extension match is
   * case-insensitive: `Foo.KT` and `Foo.kt` gate identically. Filesystems
   * vary on case sensitivity, and `LANGUAGE_EXTENSIONS` lists lowercase, so a
   * case-sensitive compare would let `.KT` slip past the gate unchecked. */
  gates(filePath: string): boolean {
    return this.gatedExtensions.has(path.extname(filePath).toLowerCase());
  }

  /** Absolute paths of every rule file in the enabled packs, sorted. */
  ruleFiles(): string[] {
    const files: string[] = [];
    for (const pack of this.enabledPacks) {
      const rulesDir = path.join(this.packsDir, pack, "rules");
      if (!fs.existsSync(rulesDir)) continue;
      const inPack: string[] = [];
      for (const name of fs.readdirSync(rulesDir)) {
        if (name.endsWith(".yml") || name.endsWith(".yaml")) inPack.push(path.join(rulesDir, name));
      }
      files.push(...inPack.sort());
    }
    return files;
  }

  /** The rule's tier: a per-rule override, else the project default. */
  tierFor(ruleId: string): string {
    return this.ruleOverrides[ruleId]?.tier ?? this.defaultTier;
  }

  /** A per-rule table's `enabled` wins when present; otherwise a rule
   * defaults to its pack.yml's `default_enabled` (true when unset). */
  ruleEnabled(ruleId: string): boolean {
    const override = this.ruleOverrides[ruleId]?.enabled;
    if (override !== undefined) return override;
    return this.packRuleDefaults[ruleId] ?? true;
  }
}

/**
 * Locate the nearest `.tenets/config.toml` at or above `startPath`.
 *
 * Returns a Config, or null when no `.tenets/` exists — a project without
 * one is simply not enforcing, so the gate stays inert.
 */
export async function find(startPath: string): Promise<Config | null> {
  const resolved = path.resolve(startPath);
  let directory = isDirectory(resolved) ? resolved : path.dirname(resolved);
  for (;;) {
    const candidate = path.join(directory, TENETS_DIRNAME, CONFIG_FILENAME);
    // biome-ignore lint/performance/noAwaitInLoops: walks upward one directory at a time and stops at the first .tenets/ found; inherently sequential
    if (await Bun.file(candidate).exists()) {
      return load(candidate);
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function load(configPath: string): Promise<Config> {
  const data = (await import(configPath, { with: { type: "toml" } })).default as ConfigToml;
  const configDir = path.dirname(configPath);

  const core = data.core ?? {};
  const languages = core.languages ?? [];
  if (!Array.isArray(languages)) {
    // e.g. `languages = "kotlin"` — a bracket-typo that TOML accepts as a
    // valid string scalar. Left unchecked, gatedExtensions would iterate the
    // string's characters and gate nothing, so the whole gate goes silently
    // inert instead of failing loudly. Throw instead: the caller's fail-closed
    // wrapper turns this into a deny.
    throw new Error(`.tenets/config.toml: [core].languages must be an array of strings, got ${typeof languages}`);
  }
  const defaultTier = core.default_tier ?? TIER_DENY;

  const packs = data.packs ?? {};
  let packsDir = packs.packs_dir ?? "";
  if (!path.isAbsolute(packsDir)) {
    packsDir = path.resolve(configDir, packsDir);
  }
  const enabledPacks = packs.enabled ?? [];
  if (!Array.isArray(enabledPacks)) {
    throw new Error(`.tenets/config.toml: [packs].enabled must be an array of strings, got ${typeof enabledPacks}`);
  }

  const packRuleDefaults: Record<string, boolean> = {};
  for (const pack of enabledPacks) {
    const packYml = Bun.file(path.join(packsDir, pack, "pack.yml"));
    // biome-ignore lint/performance/noAwaitInLoops: sequential so later packs' pack.yml defaults deterministically win the Object.assign merge
    if (await packYml.exists()) {
      Object.assign(packRuleDefaults, packRuleDefaultsFrom(await packYml.text()));
    }
  }

  return new Config(configDir, languages, defaultTier, packsDir, enabledPacks, data.rules ?? {}, packRuleDefaults);
}

/** Applies one line inside the `rules:` block: `- id:` starts a new rule
 * (its id is returned, to track across subsequent lines), `default_enabled:`
 * records that rule's default onto `defaults`. Any other line returns
 * `currentId` unchanged. */
function applyPackRuleLine(
  defaults: Record<string, boolean>,
  currentId: string | null,
  stripped: string,
): string | null {
  if (stripped.startsWith("- id:")) {
    return stripped.slice("- id:".length).trim();
  }
  if (stripped.startsWith("default_enabled:") && currentId !== null) {
    const value = stripped.slice("default_enabled:".length).trim();
    defaults[currentId] = value.toLowerCase() === "true";
  }
  return currentId;
}

/**
 * Read each rule's `default_enabled` out of a pack.yml's `rules:` list.
 *
 * Not a YAML parser: pack.yml is a small, self-authored manifest (a flat
 * `rules:` list of `- id: ...` entries with scalar keys), and this scan only
 * ever looks at that one list. Rules the list doesn't mention default to
 * enabled, so callers should treat a missing key as true.
 */
export function packRuleDefaultsFrom(packYmlText: string): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  let currentId: string | null = null;
  let inRules = false;
  for (const rawLine of packYmlText.split(PACK_YML_LINE_SPLIT_RE)) {
    const [line] = rawLine.split("#", 1);
    if (line === undefined) continue;
    const stripped = line.trim();
    if (!inRules) {
      if (stripped === "rules:") inRules = true;
      continue;
    }
    if (!stripped) continue;
    if (!INDENTED_LINE_RE.test(line)) break; // dedented past the rules: block
    currentId = applyPackRuleLine(defaults, currentId, stripped);
  }
  return defaults;
}
