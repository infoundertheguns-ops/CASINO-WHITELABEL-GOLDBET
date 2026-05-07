// ═══════════════════════════════════════════════════
// Flashscore Feed Parser — Pipe-delimited format
// Shared logic between standalone scraper and Vincitu lib
// ═══════════════════════════════════════════════════

// ═══ TYPES ═══

export interface FeedRecord {
  [key: string]: string;
}

export interface FlashscoreResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  periods: number[][];
  status: "finished" | "live" | "not_started" | "cancelled" | "interrupted";
  timestamp: number;
  country: string;
  league: string;
  sport: string;
}

export interface FlashscoreFixture {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  timestamp: number;
  country: string;
  league: string;
  sport: string;
}

export interface FlashscoreLive {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number | null;
  scoreAway: number | null;
  periods: number[][]; // partial per-period breakdown (legacy flat — kept for backwards compat)
  stageCode: string; // raw AB status code (lets admin derive minute/state)
  timestamp: number;
  country: string;
  league: string;
  sport: string;
  // Optional enrichment from df_su_1_{matchId} + df_st_1_{matchId} fetched per-match.
  // Live loop attaches when available; admin persists into events_v2.live_data.
  summary?: FlashscoreSummary;
  stats?: FlashscoreStat[];
}

// ═══ FIELD CODES ═══

// Field codes — verified 2026-03-03 from live API responses
export const F = {
  MATCH_ID: "AA",
  STAGE: "AB", // 1=not started, 2=live, 3=finished
  TIMESTAMP: "AD", // unix timestamp (seconds)
  HOME_TEAM: "AE",
  AWAY_TEAM: "AF",
  SCORE_HOME: "AG", // FT home score (or sets won in tennis)
  SCORE_AWAY: "AH", // FT away score (or sets won in tennis)
  // Period scores — BA/BB through BI/BJ
  // Football: BC/BD = 1st half only
  // Tennis: BA/BB=set1, BC/BD=set2, BE/BF=set3, BG/BH=set4, BI/BJ=set5
  // Basketball: BA/BB=Q1, BC/BD=Q2, BE/BF=Q3, BG/BH=Q4, BI/BJ=OT
  // Hockey: BA/BB=P1, BC/BD=P2, BE/BF=P3, BG/BH=OT
  PERIOD_FIELDS: [
    ["BA", "BB"],
    ["BC", "BD"],
    ["BE", "BF"],
    ["BG", "BH"],
    ["BI", "BJ"],
  ] as [string, string][],
  COUNTRY_NAME: "ZY",
} as const;

// ═══ PIPE-DELIMITED PARSER ═══
// Records separated by ~ (tilde)
// Fields separated by ¬ (not sign)
// Key/value separated by ÷ (division) or · (middle dot)

export function parseFeed(raw: string): FeedRecord[] {
  const items = raw.split("~");
  const result: FeedRecord[] = [];

  for (const item of items) {
    if (!item || item.trim() === "") continue;

    const fields = item.split("¬");
    const record: FeedRecord = {};

    for (const field of fields) {
      if (!field || field.trim() === "") continue;

      let key: string;
      let value: string;

      const divIdx = field.indexOf("÷");
      const dotIdx = field.indexOf("·");

      if (divIdx >= 0) {
        key = field.substring(0, divIdx);
        value = field.substring(divIdx + 1);
      } else if (dotIdx >= 0) {
        key = field.substring(0, dotIdx);
        value = field.substring(dotIdx + 1);
      } else {
        continue;
      }

      if (!record[key]) {
        record[key] = value;
      } else {
        record[`${key}_2`] = value;
      }
    }

    if (Object.keys(record).length > 0) {
      result.push(record);
    }
  }

  return result;
}

// ═══ PARSE RESULTS FEED ═══

export function parseResultsFeed(raw: string, sport: string): FlashscoreResult[] {
  const records = parseFeed(raw);
  const results: FlashscoreResult[] = [];
  let currentCountry = "";
  let currentLeague = "";

  for (const rec of records) {
    // League header — has ZA but no AA (match ID)
    if (rec["ZA"] && !rec[F.MATCH_ID]) {
      currentCountry = rec[F.COUNTRY_NAME] || currentCountry;
      const zaText = rec["ZA"] || "";
      if (zaText.includes(":")) {
        currentLeague = zaText.split(":").slice(1).join(":").trim();
      } else {
        currentLeague = zaText;
      }
      continue;
    }

    const matchId = rec[F.MATCH_ID];
    const homeTeam = rec[F.HOME_TEAM];
    const awayTeam = rec[F.AWAY_TEAM];
    if (!matchId || !homeTeam || !awayTeam) continue;

    const status = parseStatus(rec[F.STAGE] || "");
    if (status !== "finished") continue;

    const scoreHome = safeInt(rec[F.SCORE_HOME]);
    const scoreAway = safeInt(rec[F.SCORE_AWAY]);
    if (scoreHome === null || scoreAway === null) continue;

    // Period scores from B-fields
    const periods: number[][] = [];
    for (const [hk, ak] of F.PERIOD_FIELDS) {
      const h = safeInt(rec[hk]);
      const a = safeInt(rec[ak]);
      if (h !== null && a !== null) periods.push([h, a]);
    }

    results.push({
      matchId,
      homeTeam,
      awayTeam,
      scoreHome,
      scoreAway,
      periods,
      status,
      timestamp: safeInt(rec[F.TIMESTAMP]) || 0,
      country: currentCountry,
      league: currentLeague,
      sport,
    });
  }

  return results;
}

// ═══ PARSE FIXTURES FEED ═══

export function parseFixturesFeed(raw: string, sport: string): FlashscoreFixture[] {
  const records = parseFeed(raw);
  const fixtures: FlashscoreFixture[] = [];
  let currentCountry = "";
  let currentLeague = "";

  for (const rec of records) {
    // League header — has ZA but no AA
    if (rec["ZA"] && !rec[F.MATCH_ID]) {
      currentCountry = rec[F.COUNTRY_NAME] || currentCountry;
      const zaText = rec["ZA"] || "";
      if (zaText.includes(":")) {
        currentLeague = zaText.split(":").slice(1).join(":").trim();
      } else {
        currentLeague = zaText;
      }
      continue;
    }

    const matchId = rec[F.MATCH_ID];
    const homeTeam = rec[F.HOME_TEAM];
    const awayTeam = rec[F.AWAY_TEAM];
    if (!matchId || !homeTeam || !awayTeam) continue;

    const status = parseStatus(rec[F.STAGE] || "");
    if (status !== "not_started") continue;

    fixtures.push({
      matchId,
      homeTeam,
      awayTeam,
      timestamp: safeInt(rec[F.TIMESTAMP]) || 0,
      country: currentCountry,
      league: currentLeague,
      sport,
    });
  }

  return fixtures;
}

// ═══ PARSE LIVE FEED ═══

export function parseLiveFeed(raw: string, sport: string): FlashscoreLive[] {
  const records = parseFeed(raw);
  const live: FlashscoreLive[] = [];
  let currentCountry = "";
  let currentLeague = "";

  for (const rec of records) {
    if (rec["ZA"] && !rec[F.MATCH_ID]) {
      currentCountry = rec[F.COUNTRY_NAME] || currentCountry;
      const zaText = rec["ZA"] || "";
      currentLeague = zaText.includes(":") ? zaText.split(":").slice(1).join(":").trim() : zaText;
      continue;
    }

    const matchId = rec[F.MATCH_ID];
    const homeTeam = rec[F.HOME_TEAM];
    const awayTeam = rec[F.AWAY_TEAM];
    if (!matchId || !homeTeam || !awayTeam) continue;

    const stageCode = (rec[F.STAGE] || "").trim();
    const status = parseStatus(stageCode);
    if (status !== "live") continue;

    const periods: number[][] = [];
    for (const [hk, ak] of F.PERIOD_FIELDS) {
      const h = safeInt(rec[hk]);
      const a = safeInt(rec[ak]);
      if (h !== null && a !== null) periods.push([h, a]);
    }

    live.push({
      matchId,
      homeTeam,
      awayTeam,
      scoreHome: safeInt(rec[F.SCORE_HOME]),
      scoreAway: safeInt(rec[F.SCORE_AWAY]),
      periods,
      stageCode,
      timestamp: safeInt(rec[F.TIMESTAMP]) || 0,
      country: currentCountry,
      league: currentLeague,
      sport,
    });
  }

  return live;
}

// ═══ HELPERS ═══

function parseStatus(
  code: string
): "finished" | "live" | "not_started" | "cancelled" | "interrupted" {
  const c = code.trim();
  if (c === "3" || c === "31" || c === "32") return "finished";
  if (c === "2" || c === "12" || c === "13" || c === "38") return "live";
  if (c === "1") return "not_started";
  if (c === "51" || c === "52" || c === "70" || c === "90") return "cancelled";
  if (c === "61") return "interrupted";

  const num = parseInt(c, 10);
  if (!isNaN(num)) {
    if (num >= 30 && num < 40) return "finished";
    if (num >= 10 && num < 30) return "live";
    if (num >= 50) return "cancelled";
  }
  return "not_started";
}

function safeInt(val: string | undefined): number | null {
  if (val === undefined || val === "" || val === null) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// ═══════════════════════════════════════════════════
// SUMMARY FEED (df_su_1_{matchId}) — periods + incidents + meta
// ═══════════════════════════════════════════════════

export interface FlashscorePeriod {
  name: string; // "1st Half", "2nd Half", "Extra Time", "Penalties", "Q1", "Set 1", "1st Period", or sport-default for raw codes
  homeScore: number | null;
  awayScore: number | null;
  durationSec?: number | null; // tennis set duration (RC/RD/RE)
  homeTiebreak?: number | null; // tennis DA/DB/DC...
  awayTiebreak?: number | null;
}

export interface FlashscorePlayer {
  name: string;
  id: string; // stable FS player ID
  url: string; // /player/slug/id/ — stable
}

export interface FlashscoreIncident {
  id: string; // III
  period: string; // inherited from most-recent AC header
  team: 1 | 2; // IA: 1=home, 2=away
  minute: string; // IB raw — "23'" / "09:49" / etc.
  typeCode: number | null; // IE primary
  label: string; // IK primary — "Goal" / "Yellow Card" / "Red Card" / "Substitution" / etc.
  subLabel?: string; // IL — e.g. "Power-play"
  player: FlashscorePlayer;
  scoreAfter?: { home: number; away: number }; // INX/IOX after the incident
  // For incidents with co-actors (assists, substituted player, etc.)
  // Each entry mirrors the additional IE/IF/IU/IK/IM cluster within the same record.
  related?: Array<{
    typeCode: number | null;
    label: string; // "Assistance" / "Assistance 2" / "Substituted out" / etc.
    player: FlashscorePlayer;
  }>;
}

export interface FlashscoreMatchMeta {
  referee?: { name: string; country?: string; code?: string };
  venue?: string;
  town?: string;
  capacity?: number | null;
  attendance?: number | null;
  liveStatus?: string; // LS — toss/strategic notes (cricket etc.)
  rawCodes?: string; // AC raw single-int codes (e.g. esports "3"=finished)
}

export interface FlashscoreSummary {
  matchId: string;
  periods: FlashscorePeriod[];
  incidents: FlashscoreIncident[];
  meta: FlashscoreMatchMeta;
}

// Sport-specific mapping for AC=integer codes (when FS sends just "3" not "1st Half")
// and for BA/BB...BR fallback period naming when AC headers are absent.
const PERIOD_DEFAULTS_BY_SPORT: Record<string, string[]> = {
  basketball: ["Q1", "Q2", "Q3", "Q4", "OT"],
  "ice-hockey": ["1st Period", "2nd Period", "3rd Period", "OT", "SO"],
  tennis: ["Set 1", "Set 2", "Set 3", "Set 4", "Set 5"],
  volleyball: ["Set 1", "Set 2", "Set 3", "Set 4", "Set 5"],
  baseball: [
    "1st Inn",
    "2nd Inn",
    "3rd Inn",
    "4th Inn",
    "5th Inn",
    "6th Inn",
    "7th Inn",
    "8th Inn",
    "9th Inn",
    "Extra",
  ],
  handball: ["1st Half", "2nd Half", "OT"],
  football: ["1st Half", "2nd Half", "Extra Time", "Penalties"],
  rugby: ["1st Half", "2nd Half", "Extra Time"],
  cricket: ["Innings"],
  "american-football": ["Q1", "Q2", "Q3", "Q4", "OT"],
};

const PERIOD_FIELD_PAIRS = [
  ["BA", "BB"],
  ["BC", "BD"],
  ["BE", "BF"],
  ["BG", "BH"],
  ["BI", "BJ"],
  ["BK", "BL"],
  ["BM", "BN"],
  ["BO", "BP"],
  ["BQ", "BR"],
] as const;

const TIEBREAK_FIELD_PAIRS = [
  ["DA", "DB"],
  ["DC", "DD"],
  ["DE", "DF"],
] as const;

const DURATION_FIELDS = ["RB", "RC", "RD", "RE", "RF"] as const;

function parseDurationToSec(raw: string | undefined): number | null {
  if (!raw) return null;
  // Format "1:09" (h:mm) or "57:23" (mm:ss)? FS uses h:mm typically for set durations
  const m = raw.match(/^(\d+):(\d+)$/);
  if (!m) return safeInt(raw);
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (isNaN(a) || isNaN(b)) return null;
  // If second part > 59 invalid; assume h:mm (set durations are typically 30-90 min)
  return a * 60 * 60 + b * 60;
}

/**
 * Parse df_su_1_{matchId} feed — summary with structured periods + incidents + meta.
 * Tolerant: empty/missing fields → empty arrays, never throws.
 */
export function parseSummaryFeed(
  raw: string,
  sport: string,
  matchId: string
): FlashscoreSummary {
  const summary: FlashscoreSummary = {
    matchId,
    periods: [],
    incidents: [],
    meta: {},
  };
  if (!raw || raw.trim().length < 5) return summary;

  const sportKey = sport.trim().toLowerCase();
  const defaults = PERIOD_DEFAULTS_BY_SPORT[sportKey] || [];
  const items = raw.split("~");

  let currentPeriod = "";
  let periodCounter = 0;
  let acRawCodes: string[] = [];

  // Match-meta accumulator: MIT/MIV pairs are interleaved.
  const metaPairs: Array<{ key: string; val: string }> = [];

  for (const item of items) {
    if (!item || item.trim() === "") continue;
    const fields = item
      .split("¬")
      .filter((f) => f && f.trim() !== "")
      .map((f) => {
        const idx = f.indexOf("÷");
        if (idx < 0) return null;
        return { k: f.substring(0, idx), v: f.substring(idx + 1) };
      })
      .filter((x): x is { k: string; v: string } => x !== null);

    if (fields.length === 0) continue;

    // Walk fields in order — emit incidents on III boundaries.
    // AC field acts as period boundary; BA/BB sets period scores when AC is just a code.
    let activeIncident: FlashscoreIncident | null = null;
    // Per-incident transient buffers for current "actor" cluster
    let actorBuf: Partial<{
      typeCode: number | null;
      label: string;
      name: string;
      id: string;
      url: string;
    }> = {};

    const flushActor = () => {
      if (!activeIncident) {
        actorBuf = {};
        return;
      }
      // The first cluster fills primary actor; subsequent clusters become `related[]`.
      const hasName = !!actorBuf.name;
      if (!hasName) {
        actorBuf = {};
        return;
      }
      if (!activeIncident.player.name) {
        activeIncident.player = {
          name: actorBuf.name || "",
          id: actorBuf.id || "",
          url: actorBuf.url || "",
        };
        activeIncident.typeCode =
          actorBuf.typeCode ?? activeIncident.typeCode;
        activeIncident.label = actorBuf.label || activeIncident.label;
      } else {
        if (!activeIncident.related) activeIncident.related = [];
        activeIncident.related.push({
          typeCode: actorBuf.typeCode ?? null,
          label: actorBuf.label || "",
          player: {
            name: actorBuf.name || "",
            id: actorBuf.id || "",
            url: actorBuf.url || "",
          },
        });
      }
      actorBuf = {};
    };

    const flushIncident = () => {
      flushActor();
      if (activeIncident && activeIncident.id) {
        summary.incidents.push(activeIncident);
      }
      activeIncident = null;
    };

    // Period-level fields collected from this record (pre-incident scope)
    let recordPeriodScore: { home: number | null; away: number | null } = {
      home: null,
      away: null,
    };
    const recordPositional: Record<string, string> = {};

    for (const { k, v } of fields) {
      // Period header (AC)
      if (k === "AC") {
        flushIncident();
        // AC may be a name ("1st Half") or a numeric code ("3"=finished)
        if (/^\d+$/.test(v)) {
          acRawCodes.push(v);
        } else {
          currentPeriod = v;
        }
        continue;
      }

      // New incident boundary
      if (k === "III") {
        flushIncident();
        activeIncident = {
          id: v,
          period: currentPeriod || (defaults[periodCounter] ?? ""),
          team: 1,
          minute: "",
          typeCode: null,
          label: "",
          player: { name: "", id: "", url: "" },
        };
        actorBuf = {};
        continue;
      }

      // Incident-level fields
      if (activeIncident) {
        switch (k) {
          case "IA":
            activeIncident.team = v === "2" ? 2 : 1;
            break;
          case "IB":
            activeIncident.minute = v;
            break;
          case "IL":
            activeIncident.subLabel = v;
            break;
          case "INX":
            activeIncident.scoreAfter = activeIncident.scoreAfter || {
              home: 0,
              away: 0,
            };
            activeIncident.scoreAfter.home = safeInt(v) ?? 0;
            break;
          case "IOX":
            activeIncident.scoreAfter = activeIncident.scoreAfter || {
              home: 0,
              away: 0,
            };
            activeIncident.scoreAfter.away = safeInt(v) ?? 0;
            break;
          // Actor cluster fields: IE/IF/IU/IK/IM. A new IE starts a new actor
          // cluster (after the first), so flush before assigning when actorBuf
          // is already populated AND we already saw an IE for it.
          case "IE":
            if (actorBuf.typeCode !== undefined) flushActor();
            actorBuf.typeCode = safeInt(v);
            break;
          case "IF":
            if (actorBuf.name) flushActor();
            actorBuf.name = v;
            break;
          case "IU":
            actorBuf.url = v;
            break;
          case "IK":
            actorBuf.label = v;
            break;
          case "IM":
            actorBuf.id = v;
            break;
          case "ICT":
          case "IC":
          case "IJ":
            // Currently observed but unused; safe to ignore.
            break;
        }
        continue;
      }

      // Period score fields (BA/BB ... BR): record positionally — emitted
      // as period entries below when the record ends.
      recordPositional[k] = v;

      // Period-end IG/IH (only meaningful before any incident in this record)
      if (k === "IG") recordPeriodScore.home = safeInt(v);
      else if (k === "IH") recordPeriodScore.away = safeInt(v);

      // Match meta accumulator
      if (k === "MIT" || k === "MIV") {
        metaPairs.push({ key: k, val: v });
      } else if (k === "LS") {
        summary.meta.liveStatus = v;
      }
    }

    flushIncident();

    // After processing record fields, decide if this record represented a period.
    if (currentPeriod && (recordPeriodScore.home !== null || recordPeriodScore.away !== null)) {
      // AC-based period entry (e.g. football 1st Half with IG/IH)
      summary.periods.push({
        name: currentPeriod,
        homeScore: recordPeriodScore.home,
        awayScore: recordPeriodScore.away,
      });
      periodCounter = summary.periods.length;
    } else {
      // BA/BB ... BR positional period scores within a single record (basket/baseball/tennis)
      const periodEntries: FlashscorePeriod[] = [];
      for (let i = 0; i < PERIOD_FIELD_PAIRS.length; i++) {
        const [hk, ak] = PERIOD_FIELD_PAIRS[i];
        const h = safeInt(recordPositional[hk]);
        const a = safeInt(recordPositional[ak]);
        if (h === null && a === null) continue;
        const name = defaults[i] ?? `P${i + 1}`;
        const period: FlashscorePeriod = {
          name,
          homeScore: h,
          awayScore: a,
        };
        // Tennis tiebreak per set
        if (i < TIEBREAK_FIELD_PAIRS.length) {
          const [tbh, tba] = TIEBREAK_FIELD_PAIRS[i];
          const th = safeInt(recordPositional[tbh]);
          const ta = safeInt(recordPositional[tba]);
          if (th !== null) period.homeTiebreak = th;
          if (ta !== null) period.awayTiebreak = ta;
        }
        // Tennis set duration RC/RD/RE for sets 1/2/3
        const durKey = DURATION_FIELDS[i + 1]; // RB=match total, RC=set1
        if (durKey && recordPositional[durKey]) {
          period.durationSec = parseDurationToSec(recordPositional[durKey]);
        }
        periodEntries.push(period);
      }
      if (periodEntries.length > 0) {
        // Replace prior positional pass — these supersede if AC header pass
        // didn't produce structured entries.
        if (summary.periods.length === 0) summary.periods = periodEntries;
        periodCounter = summary.periods.length;
      }
    }
  }

  // Resolve match meta from MIT/MIV interleaved pairs
  // Pairs come like: MIT=REF, MIV=Carrillo M., MIT=RCO, MIV=128, MIT=RTY, MIV=23, ...
  for (let i = 0; i < metaPairs.length - 1; i++) {
    if (metaPairs[i].key === "MIT" && metaPairs[i + 1].key === "MIV") {
      const code = metaPairs[i].val;
      const value = metaPairs[i + 1].val;
      switch (code) {
        case "REF":
          summary.meta.referee = { ...(summary.meta.referee || { name: "" }), name: value };
          break;
        case "RCC":
          summary.meta.referee = {
            ...(summary.meta.referee || { name: "" }),
            country: value,
          };
          break;
        case "RCO":
          summary.meta.referee = {
            ...(summary.meta.referee || { name: "" }),
            code: value,
          };
          break;
        case "VEN":
          summary.meta.venue = value;
          break;
        case "TWN":
          summary.meta.town = value;
          break;
        case "CAP":
          summary.meta.capacity = safeInt(value.replace(/\s+/g, ""));
          break;
        case "ATT":
          summary.meta.attendance = safeInt(value.replace(/\s+/g, ""));
          break;
      }
      i++; // skip the MIV we just consumed
    }
  }

  if (acRawCodes.length > 0) summary.meta.rawCodes = acRawCodes.join(",");

  return summary;
}

// ═══════════════════════════════════════════════════
// STATS FEED (df_st_1_{matchId}) — by-section stats with stable code (SD)
// ═══════════════════════════════════════════════════

export interface FlashscoreStat {
  section: string; // SE — "Match" / "1st Half" / "2nd Half" / "Set 1" / etc.
  category: string; // SF — "Top stats" / "Shots" / "Attack" / "Service" / ...
  code: number | null; // SD — stable canonical stat code (12=possession, 16=corners, ...)
  name: string; // SG — human label
  home: string; // SH (raw — may be "55%" / "65% (64/99)" / "39")
  away: string; // SI
}

/**
 * Parse df_st_1_{matchId} into structured stats, preserving section + canonical code.
 * Tolerant: empty raw → empty array.
 */
export function parseStatsFeed(raw: string): FlashscoreStat[] {
  if (!raw || raw.trim().length < 3) return [];
  const out: FlashscoreStat[] = [];
  const items = raw.split("~");

  let currentSection = "Match";
  let currentCategory = "";
  let pendingCode: number | null = null;

  for (const item of items) {
    if (!item || item.trim() === "") continue;
    const fields = item.split("¬");
    const rec: Record<string, string> = {};
    for (const f of fields) {
      const idx = f.indexOf("÷");
      if (idx < 0) continue;
      const k = f.substring(0, idx);
      const v = f.substring(idx + 1);
      // For stats records each key appears at most once per record
      if (!(k in rec)) rec[k] = v;
    }

    if (rec.SE) currentSection = rec.SE;
    if (rec.SF) currentCategory = rec.SF;
    if (rec.SD) pendingCode = safeInt(rec.SD);

    if (rec.SG) {
      out.push({
        section: currentSection,
        category: currentCategory,
        code: pendingCode,
        name: rec.SG,
        home: rec.SH ?? "",
        away: rec.SI ?? "",
      });
      pendingCode = null; // SD applies to the next SG only
    }
  }

  return out;
}
