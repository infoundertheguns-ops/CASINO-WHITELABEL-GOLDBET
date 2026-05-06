import aliasesRaw from "./team-aliases.json" with { type: "json" };

const ALIASES = aliasesRaw as Record<string, string>;
const DIACRITIC_RE = /[̀-ͯ]/g;

const _DEFAULT_NOISE = new Set([
  // Generic club affixes
  "fc", "ac", "cf", "sc", "sk", "ss", "ssc", "usl", "calcio", "afc", "cfc", "usd",
  // Eastern European prefixes (from 2026-05-06 discovery + common others)
  "gks", "kkp", "kf", "fk", "mfk", "ks", "bk", "ofk", "zsk",
  "nk", "hnk", "gnk", "ffk", "fck", "rfk",
  // Women's-team marker (FS-side appends " D" to women's names)
  "d",
  // Filler
  "club", "team", "sport", "sports",
]);

const _DEFAULT_RESERVE = new Set([
  "ii", "iii", "b", "c",
  "u17", "u19", "u20", "u21", "u23",
  "2", "3",
  "youth", "academy", "reserves",
]);

const NOISE_TOKENS_BY_SPORT: Record<string, Set<string>> = {
  _default: _DEFAULT_NOISE,
  // tennis, baseball populated in B1.B based on captured samples
};

const RESERVE_MARKERS_BY_SPORT: Record<string, Set<string>> = {
  _default: _DEFAULT_RESERVE,
  // tennis, baseball populated in B1.B if needed
};

function noiseFor(slug: string): Set<string> {
  return NOISE_TOKENS_BY_SPORT[slug] ?? NOISE_TOKENS_BY_SPORT._default;
}
function reserveFor(slug: string): Set<string> {
  return RESERVE_MARKERS_BY_SPORT[slug] ?? RESERVE_MARKERS_BY_SPORT._default;
}

const DISCRIMINATING_MIN_LEN = 4;

export interface NormalizedTeam {
  /** All non-NOISE tokens, including reserve markers, post-alias substitution */
  tokens: string[];
  /** join(" ") of non-reserve tokens, post-alias — used for strict equality */
  key: string;
  /** Subset of tokens that match RESERVE_MARKERS (e.g. {"b"}, {"u21"}, {"2"}) */
  reserveMarkers: Set<string>;
}

function tokenize(raw: string, sportSlug: string): string[] {
  const noise = noiseFor(sportSlug);
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RE, "")
    .replace(/[.']/g, "")
    .split(/[\s\-/&]+/)
    .filter((t) => t.length > 0 && !noise.has(t));
}

export function normalizeTeam(raw: string, sportSlug: string): NormalizedTeam {
  const tokens = tokenize(raw, sportSlug);
  const reserve = reserveFor(sportSlug);
  const reserveMarkers = new Set(tokens.filter((t) => reserve.has(t)));
  const nonReserve = tokens.filter((t) => !reserve.has(t));
  const baseKey = nonReserve.join(" ");

  // Alias lookup — uses the non-reserve key (so "Bayern" → "bayern munchen", not "bayern II")
  const aliased = ALIASES[`${sportSlug}:${baseKey}`];
  if (aliased) {
    return { tokens: aliased.split(" "), key: aliased, reserveMarkers };
  }
  return { tokens: nonReserve, key: baseKey, reserveMarkers };
}

export function matchTeams(a: NormalizedTeam, b: NormalizedTeam): boolean {
  if (a.key.length === 0 || b.key.length === 0) return false;

  // Stage 1: reserve marker mismatch — hard fail (Roma ≠ Roma B)
  if (!setsEqual(a.reserveMarkers, b.reserveMarkers)) return false;

  // Stage 2: strict eq on canonical key (fast path, common case)
  if (a.key === b.key) return true;

  // Stage 3: subset on discriminating tokens. We use a.reserveMarkers (== b.reserveMarkers
  // by Stage 1 gate) instead of a module-level RESERVE_MARKERS set. Behavior equivalence
  // depends on the constraint that any sport-specific RESERVE_MARKERS_BY_SPORT[X] entries
  // ≥ DISCRIMINATING_MIN_LEN (4 chars) must always also appear in normalizeTeam's tokens
  // when the team string contains them — which is true since reserveMarkers are populated
  // from `tokens` in normalizeTeam itself. If B1.B adds tennis reserve markers with len≥4,
  // ensure they pass through tokenize (i.e. are not on the per-sport NOISE list).
  const reserve = a.reserveMarkers;
  const aDisc = new Set(a.tokens.filter((t) => t.length >= DISCRIMINATING_MIN_LEN && !reserve.has(t)));
  const bDisc = new Set(b.tokens.filter((t) => t.length >= DISCRIMINATING_MIN_LEN && !reserve.has(t)));
  if (aDisc.size === 0 || bDisc.size === 0) return false;
  return isSubset(aDisc, bDisc) || isSubset(bDisc, aDisc);
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function isSubset<T>(a: Set<T>, b: Set<T>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
