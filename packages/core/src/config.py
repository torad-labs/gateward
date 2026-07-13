"""Reads ``.tenets/config.toml`` — the installed, per-project gate configuration.

The core is standard-library only: this module parses TOML with :mod:`tomllib`
(Python 3.11+), so the engine carries no third-party dependency. It never parses
rule YAML — ast-grep owns rule semantics.

Schema (minimal by design)::

    [core]
    languages    = ["kotlin"]      # which languages this project gates
    default_tier = "deny"          # tier for any rule not listed below

    [packs]
    packs_dir = "../../../packs"          # rule-packs root. A relative path
    enabled   = ["kotlin-best-practices"] #   resolves from THIS file's directory.

    # Optional per-rule tables. ``tier`` overrides default_tier for one rule;
    # ``enabled`` forces it on or off. A rule's default tier is authored upstream
    # in its pack's pack.yml; the installer reflects the ones worth changing into
    # this file so the stdlib core never has to read rule YAML.
    [rules.no-assert-equals-boolean]
    tier = "autofix"

The language-to-extension mapping lives in code (:data:`LANGUAGE_EXTENSIONS`):
the config names languages, the core knows their file extensions. Tier is
resolved here because ast-grep's scan JSON does not surface rule metadata.

A pack's ``pack.yml`` may mark a rule ``default_enabled: false`` (house-taste
opinions a project must opt into). ``pack.yml`` is a small, self-authored
manifest, not rule YAML, so reading its ``rules:`` list stays consistent with
"the core never parses rule YAML": :func:`_pack_rule_defaults` does a narrow,
line-oriented scan of that one list — no YAML dependency required — and
:meth:`Config.rule_enabled` only falls back to it when ``.tenets/config.toml``
has no explicit ``enabled`` for the rule.
"""
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

TENETS_DIRNAME = ".tenets"
CONFIG_FILENAME = "config.toml"

TIER_DENY = "deny"
TIER_AUTOFIX = "autofix"

# Extensions gated for each language the packs support. Kotlin ships today.
LANGUAGE_EXTENSIONS = {
    "kotlin": (".kt", ".kts"),
}


@dataclass
class Config:
    """A resolved ``.tenets/config.toml``."""

    config_dir: Path
    languages: tuple
    default_tier: str
    packs_dir: Path
    enabled_packs: tuple
    rule_overrides: dict = field(default_factory=dict)
    pack_rule_defaults: dict = field(default_factory=dict)

    @property
    def gated_extensions(self):
        extensions = set()
        for language in self.languages:
            extensions.update(LANGUAGE_EXTENSIONS.get(language, ()))
        return extensions

    def gates(self, path):
        """True when this project gates the given file's type."""
        return Path(path).suffix in self.gated_extensions

    def rule_files(self):
        """Absolute paths of every rule file in the enabled packs, sorted."""
        files = []
        for pack in self.enabled_packs:
            rules_dir = self.packs_dir / pack / "rules"
            if rules_dir.is_dir():
                files.extend(sorted(rules_dir.glob("*.yml")))
                files.extend(sorted(rules_dir.glob("*.yaml")))
        return files

    def tier_for(self, rule_id):
        """The rule's tier: a per-rule override, else the project default."""
        return self.rule_overrides.get(rule_id, {}).get("tier", self.default_tier)

    def rule_enabled(self, rule_id):
        """A per-rule table's ``enabled`` wins when present; otherwise a rule
        defaults to its pack.yml's ``default_enabled`` (true when unset)."""
        override = self.rule_overrides.get(rule_id, {}).get("enabled")
        if override is not None:
            return override
        return self.pack_rule_defaults.get(rule_id, True)


def find(start_path):
    """Locate the nearest ``.tenets/config.toml`` at or above ``start_path``.

    Returns a :class:`Config`, or ``None`` when no ``.tenets/`` exists — a
    project without one is simply not enforcing, so the gate stays inert.
    """
    resolved = Path(start_path).resolve()
    directory = resolved if resolved.is_dir() else resolved.parent
    for candidate_dir in (directory, *directory.parents):
        candidate = candidate_dir / TENETS_DIRNAME / CONFIG_FILENAME
        if candidate.is_file():
            return _load(candidate)
    return None


def _load(config_path):
    with config_path.open("rb") as handle:
        data = tomllib.load(handle)
    config_dir = config_path.parent

    core = data.get("core", {})
    languages = tuple(core.get("languages", []))
    default_tier = core.get("default_tier", TIER_DENY)

    packs = data.get("packs", {})
    packs_dir = Path(packs.get("packs_dir", ""))
    if not packs_dir.is_absolute():
        packs_dir = (config_dir / packs_dir).resolve()
    enabled_packs = tuple(packs.get("enabled", []))

    pack_rule_defaults = {}
    for pack in enabled_packs:
        pack_yml = packs_dir / pack / "pack.yml"
        if pack_yml.is_file():
            pack_rule_defaults.update(_pack_rule_defaults(pack_yml))

    return Config(
        config_dir=config_dir,
        languages=languages,
        default_tier=default_tier,
        packs_dir=packs_dir,
        enabled_packs=enabled_packs,
        rule_overrides=data.get("rules", {}),
        pack_rule_defaults=pack_rule_defaults,
    )


def _pack_rule_defaults(pack_yml_path):
    """Read a rule's ``default_enabled`` out of a pack.yml's ``rules:`` list.

    Not a YAML parser: pack.yml is a small, self-authored manifest (a flat
    ``rules:`` list of ``- id: ...`` entries with scalar keys), and this scan
    only ever looks at that one list. Rules the list doesn't mention default
    to enabled, so callers should treat a missing key as ``True``.
    """
    defaults = {}
    current_id = None
    in_rules = False
    for raw_line in pack_yml_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0]
        stripped = line.strip()
        if not in_rules:
            if stripped == "rules:":
                in_rules = True
            continue
        if not stripped:
            continue
        if not line[:1].isspace():
            break  # dedented past the rules: block
        if stripped.startswith("- id:"):
            current_id = stripped[len("- id:"):].strip()
        elif stripped.startswith("default_enabled:") and current_id is not None:
            value = stripped[len("default_enabled:"):].strip()
            defaults[current_id] = value.lower() == "true"
    return defaults
