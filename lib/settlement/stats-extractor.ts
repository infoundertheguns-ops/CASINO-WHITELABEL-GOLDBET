export interface FlashscoreStat {
  name: string;
  home: string | number;
  away: string | number;
}

export type Period = "ft" | "ht" | "sh";
export type StatKind =
  | "corners"
  | "cards_yellow"
  | "cards_red"
  | "shots_total"
  | "shots_on_target"
  | "shots_off_target"
  | "possession";

const SECTION_LABELS: Record<Period, string> = {
  ft: "partita",
  ht: "1 tempo",
  sh: "2 tempo",
};

// All values MUST be lowercase — matched against s.name.toLowerCase()
const STAT_LABELS: Record<StatKind, string> = {
  corners: "calci d'angolo",
  cards_yellow: "cartellini gialli",
  cards_red: "cartellini rossi",
  shots_total: "tiri totali",
  shots_on_target: "tiri in porta",
  shots_off_target: "tiri fuori",
  possession: "possesso palla",
};

function toNum(v: string | number): number | null {
  if (typeof v === "number") return v;
  const s = String(v).replace("%", "").trim();
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

/** Returns the FIRST match — flashscore feed is known to emit duplicate entries. */
export function extractStat(
  stats: FlashscoreStat[],
  period: Period,
  kind: StatKind
): { home: number; away: number; total: number } | null {
  const section = SECTION_LABELS[period];
  const stat = STAT_LABELS[kind];
  const target = `${section}: ${stat}`;
  const match = stats.find((s) => s.name.toLowerCase() === target);
  if (!match) return null;
  const h = toNum(match.home);
  const a = toNum(match.away);
  if (h == null || a == null) return null;
  return { home: h, away: a, total: h + a };
}

/** Used by per-team per-period settlers (Task 0.2). */
export function extractTeamStat(
  stats: FlashscoreStat[],
  period: Period,
  kind: StatKind,
  team: "home" | "away"
): number | null {
  const r = extractStat(stats, period, kind);
  return r ? r[team] : null;
}
