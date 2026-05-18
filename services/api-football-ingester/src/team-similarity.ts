/**
 * Team-name similarity helpers — SYNCED COPY of the core scoring logic from
 * `lib/betexplorer.ts` (`normalizeTeamName` + `teamMatchScore`).
 *
 * Why a copy and not an import:
 *   - This service has its own tsconfig (`services/api-football-ingester/tsconfig.json`)
 *     with `include: ["src/**", "scripts/**"]` and no path aliases. A relative
 *     import like `../../../lib/betexplorer` fails type resolution under
 *     `moduleResolution: bundler` (verified empirically before committing).
 *   - The admin-side `teamMatchScore` pulls in `lib/team-aliases.ts` (370 lines
 *     of curated football aliases) which would balloon this service's surface.
 *
 * What is intentionally OMITTED vs the admin original:
 *   - Alias-table resolution (`resolveAliases` from `lib/team-aliases`).
 *     A future M1.x can wire DB-driven aliases (`team_aliases` table) into
 *     this helper if mapping recall proves insufficient.
 *
 * Logic preserved exactly:
 *   - normalizeTeamName: lowercase + NFD diacritic strip + suffix word strip +
 *     non-alphanum cleanup + whitespace collapse.
 *   - teamMatchScore: exact (1.0) -> containment (0.85) -> token overlap +
 *     levenshtein (0.75-1.0 if ratio<0.25) -> first-word bonus (0.7).
 *
 * Keep in sync with `lib/betexplorer.ts` if scoring rules ever change.
 */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(
      /\b(fc|sc|cf|ac|as|ss|us|ssd|asd|calcio|basket|hockey|club|sporting|sport|united|city)\b/gi,
      '',
    )
    .replace(/[^a-z0-9\s()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns a 0-1 similarity score between two team-name strings.
 * Identical contract to admin `lib/betexplorer.ts` `teamMatchScore` minus
 * alias-table resolution (see file header).
 */
export function teamMatchScore(dbName: string, beName: string): number {
  const normDb = normalizeTeamName(dbName);
  const normBe = normalizeTeamName(beName);

  if (!normDb || !normBe) return 0;
  if (normDb === normBe) return 1.0;

  // Containment
  if (normDb.includes(normBe) || normBe.includes(normDb)) return 0.85;

  // Token overlap
  const tokensDb = normDb.split(' ').filter((t) => t.length > 1);
  const tokensBe = normBe.split(' ').filter((t) => t.length > 1);
  if (tokensDb.length === 0 || tokensBe.length === 0) return 0;

  let shared = 0;
  for (const t of tokensDb) {
    if (tokensBe.some((tb) => tb === t || tb.includes(t) || t.includes(tb))) {
      shared++;
    }
  }
  const tokenScore = shared / Math.max(tokensDb.length, tokensBe.length);

  // Levenshtein bonus on very similar strings
  const maxLen = Math.max(normDb.length, normBe.length);
  if (maxLen > 0) {
    const dist = levenshtein(normDb, normBe);
    const ratio = dist / maxLen;
    if (ratio < 0.25) {
      const levScore = 1.0 - ratio;
      return Math.max(tokenScore, levScore);
    }
  }

  // First-word match bonus ("Inter" vs "Inter Milano")
  if (
    tokensDb.length > 0 &&
    tokensBe.length > 0 &&
    tokensDb[0] === tokensBe[0] &&
    tokensDb[0].length >= 3
  ) {
    return Math.max(tokenScore, 0.7);
  }

  return tokenScore;
}
