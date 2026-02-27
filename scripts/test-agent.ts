#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════
// TEST AGENT — Creates 60 test users and simulates realistic
// betting patterns across all sports (singole, multiple, sistemi)
// ═══════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ═══ CONFIG ═══

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xgnyqkmugnfzhdveeqom.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const STATE_FILE = path.join(__dirname, "test-agent-state.json");
const REPORT_FILE = path.join(__dirname, "test-agent-report.txt");

// ═══ CLI ARGS ═══

const args = process.argv.slice(2);
const ROUNDS = parseInt(args.find(a => a.startsWith("--rounds="))?.split("=")[1] || "3", 10);
const DRY_RUN = args.includes("--dry-run");
const CLEANUP = args.includes("--cleanup");
const DEBUG = args.includes("--debug");

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function debug(msg: string) { if (DEBUG) console.log(`  [DEBUG] ${msg}`); }

// ═══ TYPES ═══

type Category = "recreational" | "semi_pro" | "sharp" | "bot" | "new_account_abuser" | "multi_account" | "high_roller" | "bonus_abuser";

interface UserProfile {
  username: string;
  email: string;
  password: string;
  category: Category;
  userClass: "new" | "recreational" | "semi_pro" | "sharp" | "vip";
  kycStatus: "unverified" | "pending" | "verified";
  stakeMin: number;
  stakeMax: number;
  betsPerRound: [number, number]; // [min, max]
  betTypes: ("singola" | "multi" | "sistema")[];
  systemTypes?: string[]; // e.g. ["2/4", "3/5"]
  delayMs: [number, number]; // [min, max] delay between bets
  maxLegs: number; // max selections for multi/sistema
  oddsMin?: number;
  oddsMax?: number;
  fingerprintGroup?: string; // shared fingerprint for multi_account pairs
  ipGroup?: string; // shared IP for multi_account pairs
}

interface TestState {
  phase: string;
  users: { username: string; userId?: string; token?: string }[];
  roundsCompleted: number;
  stats: Record<string, CategoryStats>;
}

interface CategoryStats {
  users: number;
  betsPlaced: number;
  betsAccepted: number;
  betsPending: number;
  betsRejected: number;
  betsBlocked: number;
  errors: number;
  totalStake: number;
  avgRiskScore: number;
  riskScoreSum: number;
}

interface EventData {
  id: string;
  name: string;
  sport_id: string;
  is_live: boolean;
  markets: MarketData[];
}

interface MarketData {
  id: string;
  market_type: string;
  outcomes: OutcomeData[];
}

interface OutcomeData {
  id: string;
  name: string;
  odds: number;
}

// ═══ UTILITY ═══

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1);
    for (const combo of rest) result.push([arr[i], ...combo]);
  }
  return result;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

function saveState(state: TestState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState(): TestState | null {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
  return null;
}

// ═══ USER PROFILES ═══

function generateProfiles(): UserProfile[] {
  const profiles: UserProfile[] = [];

  // 20 recreational
  for (let i = 1; i <= 20; i++) {
    profiles.push({
      username: `rec_player_${i}`,
      email: `rec_player_${i}@test.vincitu.local`,
      password: `TestPass123!rec${i}`,
      category: "recreational",
      userClass: "recreational",
      kycStatus: "verified",
      stakeMin: 5, stakeMax: 50,
      betsPerRound: [2, 5],
      betTypes: i <= 14 ? ["singola"] : ["singola", "multi"],
      delayMs: [3000, 15000],
      maxLegs: 3,
    });
  }

  // 10 semi_pro
  for (let i = 1; i <= 10; i++) {
    profiles.push({
      username: `semipro_${i}`,
      email: `semipro_${i}@test.vincitu.local`,
      password: `TestPass123!semi${i}`,
      category: "semi_pro",
      userClass: "semi_pro",
      kycStatus: "verified",
      stakeMin: 50, stakeMax: 200,
      betsPerRound: [5, 15],
      betTypes: i <= 5 ? ["singola", "multi"] : ["singola", "multi", "sistema"],
      systemTypes: ["2/4", "3/5"],
      delayMs: [2000, 8000],
      maxLegs: 5,
    });
  }

  // 5 sharp
  for (let i = 1; i <= 5; i++) {
    profiles.push({
      username: `sharp_${i}`,
      email: `sharp_${i}@test.vincitu.local`,
      password: `TestPass123!sharp${i}`,
      category: "sharp",
      userClass: "sharp",
      kycStatus: "verified",
      stakeMin: 500, stakeMax: 5000,
      betsPerRound: [2, 5],
      betTypes: ["singola"],
      delayMs: [5000, 20000],
      maxLegs: 1,
      oddsMin: 1.5, oddsMax: 3.0,
    });
  }

  // 5 bot
  for (let i = 1; i <= 5; i++) {
    profiles.push({
      username: `bot_pattern_${i}`,
      email: `bot_pattern_${i}@test.vincitu.local`,
      password: `TestPass123!bot${i}`,
      category: "bot",
      userClass: "recreational",
      kycStatus: "verified",
      stakeMin: 5, stakeMax: 20,
      betsPerRound: [20, 40],
      betTypes: ["singola"],
      delayMs: [5000, 5000], // constant delay = bot pattern
      maxLegs: 1,
    });
  }

  // 5 new_account_abuser
  for (let i = 1; i <= 5; i++) {
    profiles.push({
      username: `newbie_whale_${i}`,
      email: `newbie_whale_${i}@test.vincitu.local`,
      password: `TestPass123!newbie${i}`,
      category: "new_account_abuser",
      userClass: "new",
      kycStatus: "unverified",
      stakeMin: 200, stakeMax: 2000,
      betsPerRound: [3, 8],
      betTypes: ["singola", "multi"],
      delayMs: [2000, 10000],
      maxLegs: 3,
    });
  }

  // 10 multi_account (5 pairs sharing fingerprint+IP)
  for (let i = 1; i <= 10; i++) {
    const pairId = Math.ceil(i / 2);
    profiles.push({
      username: `multi_${i}`,
      email: `multi_${i}@test.vincitu.local`,
      password: `TestPass123!multi${i}`,
      category: "multi_account",
      userClass: "recreational",
      kycStatus: "verified",
      stakeMin: 20, stakeMax: 100,
      betsPerRound: [5, 10],
      betTypes: ["singola", "multi"],
      delayMs: [3000, 10000],
      maxLegs: 3,
      fingerprintGroup: `fp_pair_${pairId}`,
      ipGroup: `192.168.${pairId}.${rand(1, 254)}`,
    });
  }

  // 3 high_roller
  for (let i = 1; i <= 3; i++) {
    profiles.push({
      username: `vip_roller_${i}`,
      email: `vip_roller_${i}@test.vincitu.local`,
      password: `TestPass123!vip${i}`,
      category: "high_roller",
      userClass: "vip",
      kycStatus: "verified",
      stakeMin: 2000, stakeMax: 9000,
      betsPerRound: [1, 3],
      betTypes: ["singola", "multi"],
      delayMs: [10000, 30000],
      maxLegs: 3,
    });
  }

  // 2 bonus_abuser
  for (let i = 1; i <= 2; i++) {
    profiles.push({
      username: `bonus_hunter_${i}`,
      email: `bonus_hunter_${i}@test.vincitu.local`,
      password: `TestPass123!bonus${i}`,
      category: "bonus_abuser",
      userClass: "recreational",
      kycStatus: "verified",
      stakeMin: 10, stakeMax: 100,
      betsPerRound: [5, 10],
      betTypes: ["sistema"],
      systemTypes: ["2/5", "2/6", "3/6"],
      delayMs: [3000, 8000],
      maxLegs: 6,
      oddsMin: 3.0, oddsMax: 20.0,
    });
  }

  return profiles;
}

// ═══ PHASE 1: CREATE USERS + FUNDING ═══

async function phase1CreateUsers(
  supabase: SupabaseClient,
  profiles: UserProfile[],
  state: TestState
): Promise<void> {
  log(`FASE 1: Creazione ${profiles.length} utenti...`);

  for (const prof of profiles) {
    // Check if already created
    const existing = state.users.find(u => u.username === prof.username);
    if (existing?.userId) {
      debug(`Skip ${prof.username} — already created`);
      continue;
    }

    if (DRY_RUN) {
      log(`  [DRY-RUN] Would create: ${prof.username} (${prof.category})`);
      state.users.push({ username: prof.username });
      continue;
    }

    try {
      // 1. Create auth user
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: prof.email,
        password: prof.password,
        email_confirm: true,
        user_metadata: { username: prof.username },
      });

      if (authErr) {
        // Might already exist
        if (authErr.message?.includes("already been registered")) {
          const { data: { users: existingUsers } } = await supabase.auth.admin.listUsers();
          const found = existingUsers?.find(u => u.email === prof.email);
          if (found) {
            debug(`${prof.username} already exists in auth, reusing ID ${found.id}`);
            state.users.push({ username: prof.username, userId: found.id });
            continue;
          }
        }
        log(`  ERROR creating auth for ${prof.username}: ${authErr.message}`);
        continue;
      }

      const userId = authData.user.id;

      // 2. Insert users row
      await supabase.from("users").upsert({
        id: userId,
        email: prof.email,
        username: prof.username,
        display_name: prof.username.replace(/_/g, " "),
        user_class: prof.userClass,
        kyc_status: prof.kycStatus,
        is_blocked: false,
        country: "IT",
      }, { onConflict: "id" });

      // 3. Insert wallet
      const { error: walletErr } = await supabase.from("wallets").upsert({
        user_id: userId,
        display_currency: "USDT",
        balance: 50000,
        bonus_balance: 0,
        locked_balance: 0,
        total_deposited: 50000,
        total_withdrawn: 0,
        total_wagered: 0,
        total_won: 0,
        version: 0,
      }, { onConflict: "user_id" });
      if (walletErr) log(`  WARN wallet for ${prof.username}: ${walletErr.message}`);

      // 4. Insert initial deposit transaction
      const { data: wallet } = await supabase
        .from("wallets").select("id").eq("user_id", userId).single();

      if (wallet) {
        await supabase.from("transactions").insert({
          user_id: userId,
          wallet_id: wallet.id,
          type: "deposit",
          amount: 50000,
          balance_before: 0,
          balance_after: 50000,
          reference_type: "admin",
          description: "Test agent initial funding",
          status: "completed",
        });
      }

      // 5. Insert fingerprint (shared for multi_account pairs)
      const fp = prof.fingerprintGroup || `fp_${prof.username}`;
      const ip = prof.ipGroup || `10.0.${rand(1, 255)}.${rand(1, 254)}`;
      await supabase.from("login_fingerprints").insert({
        user_id: userId,
        ip_address: ip,
        fingerprint: fp,
        user_agent: `TestAgent/1.0 (${prof.category})`,
        country: "IT",
      });

      state.users.push({ username: prof.username, userId });
      debug(`Created ${prof.username} (${prof.category}) — ${userId}`);
      await sleep(500); // Rate limit for admin API
    } catch (err: any) {
      log(`  ERROR ${prof.username}: ${err.message}`);
      await sleep(2000);
    }
  }

  state.phase = "users_created";
  saveState(state);
  log(`  Fase 1 completata: ${state.users.filter(u => u.userId).length} utenti creati`);
}

// ═══ PHASE 2: AUTHENTICATE ═══

async function phase2Auth(
  profiles: UserProfile[],
  state: TestState
): Promise<void> {
  log("FASE 2: Autenticazione utenti...");

  let authCount = 0;
  for (const prof of profiles) {
    const userState = state.users.find(u => u.username === prof.username);
    if (!userState?.userId) continue;
    if (userState.token) {
      authCount++;
      continue;
    }

    if (DRY_RUN) { authCount++; continue; }

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        },
        body: JSON.stringify({ email: prof.email, password: prof.password }),
      });

      if (!res.ok) {
        const text = await res.text();
        log(`  AUTH ERROR ${prof.username}: ${res.status} ${text.slice(0, 100)}`);
        continue;
      }

      const data = await res.json();
      userState.token = data.access_token;

      authCount++;
      debug(`Authenticated ${prof.username}`);

      // Rate limit: 2s between auth calls to avoid Supabase 429
      await sleep(2000);
    } catch (err: any) {
      log(`  AUTH ERROR ${prof.username}: ${err.message}`);
      await sleep(5000); // Wait longer on error (rate limit recovery)
    }
  }

  state.phase = "authenticated";
  saveState(state);
  log(`  Fase 2 completata: ${authCount} utenti autenticati`);
}

// ═══ PHASE 3: DISCOVER EVENTS ═══

async function phase3DiscoverEvents(supabase: SupabaseClient): Promise<EventData[]> {
  log("FASE 3: Scoperta eventi...");

  const { data, error } = await supabase.rpc("get_sportsbook_events", { p_limit: 500 });
  if (error) {
    log(`  ERROR fetching events: ${error.message}`);
    // Fallback: direct query
    const { data: events } = await supabase
      .from("events")
      .select("id, name, sport_id, is_live, status")
      .in("status", ["prematch", "live"])
      .limit(200);

    if (!events || events.length === 0) {
      log("  ERRORE: nessun evento trovato!");
      return [];
    }

    // Fetch markets + outcomes for these events
    const eventIds = events.map(e => e.id);
    const result: EventData[] = [];

    for (let i = 0; i < eventIds.length; i += 50) {
      const chunk = eventIds.slice(i, i + 50);
      const { data: markets } = await supabase
        .from("markets")
        .select("id, event_id, market_type, outcomes(id, name, odds, is_active)")
        .in("event_id", chunk)
        .eq("is_active", true);

      if (!markets) continue;

      const marketsByEvent: Record<string, MarketData[]> = {};
      for (const m of markets) {
        const outs = ((m as any).outcomes || [])
          .filter((o: any) => o.is_active && parseFloat(o.odds) > 1)
          .map((o: any) => ({ id: o.id, name: o.name, odds: parseFloat(o.odds) }));
        if (outs.length === 0) continue;

        if (!marketsByEvent[m.event_id]) marketsByEvent[m.event_id] = [];
        marketsByEvent[m.event_id].push({ id: m.id, market_type: m.market_type, outcomes: outs });
      }

      for (const ev of events.filter(e => chunk.includes(e.id))) {
        const mkts = marketsByEvent[ev.id];
        if (mkts && mkts.length > 0) {
          result.push({
            id: ev.id,
            name: ev.name,
            sport_id: ev.sport_id,
            is_live: ev.is_live,
            markets: mkts,
          });
        }
      }
    }

    log(`  Fase 3 completata: ${result.length} eventi con mercati attivi`);
    return result;
  }

  // Parse RPC result
  const events: EventData[] = [];
  if (Array.isArray(data)) {
    for (const ev of data) {
      const mkts: MarketData[] = [];
      const rawMarkets = ev.markets || [];
      for (const m of rawMarkets) {
        const outs = (m.outcomes || [])
          .filter((o: any) => o.is_active && parseFloat(o.odds) > 1)
          .map((o: any) => ({ id: o.id, name: o.name, odds: parseFloat(o.odds) }));
        if (outs.length === 0) continue;
        mkts.push({ id: m.id, market_type: m.market_type, outcomes: outs });
      }
      if (mkts.length > 0) {
        events.push({
          id: ev.id,
          name: ev.name,
          sport_id: ev.sport_id,
          is_live: ev.is_live,
          markets: mkts,
        });
      }
    }
  }

  log(`  Fase 3 completata: ${events.length} eventi con mercati attivi`);
  return events;
}

// ═══ PHASE 4: SIMULATE BETS ═══

function selectOutcomeFromEvent(
  event: EventData,
  profile: UserProfile
): { eventId: string; marketId: string; outcomeId: string; odds: number } | null {
  // Pick a random market from the event
  const market = pick(event.markets);
  if (!market || market.outcomes.length === 0) return null;

  // Filter outcomes by odds range if specified
  let candidates = market.outcomes;
  if (profile.oddsMin || profile.oddsMax) {
    candidates = candidates.filter(o =>
      (!profile.oddsMin || o.odds >= profile.oddsMin) &&
      (!profile.oddsMax || o.odds <= profile.oddsMax)
    );
  }
  if (candidates.length === 0) candidates = market.outcomes;

  const outcome = pick(candidates);
  return {
    eventId: event.id,
    marketId: market.id,
    outcomeId: outcome.id,
    odds: outcome.odds,
  };
}

function generateBetForProfile(
  profile: UserProfile,
  events: EventData[]
): { stake: number; selections: any[]; systemType?: string } | null {
  if (events.length === 0) return null;

  const betType = pick(profile.betTypes);

  if (betType === "singola") {
    const event = pick(events);
    const sel = selectOutcomeFromEvent(event, profile);
    if (!sel) return null;
    return {
      stake: rand(profile.stakeMin, profile.stakeMax),
      selections: [sel],
    };
  }

  if (betType === "multi") {
    const numLegs = rand(2, Math.min(profile.maxLegs, 3));
    const chosenEvents = pickN(events, numLegs);
    const selections = [];
    const usedEvents = new Set<string>();

    for (const ev of chosenEvents) {
      if (usedEvents.has(ev.id)) continue;
      const sel = selectOutcomeFromEvent(ev, profile);
      if (!sel) continue;
      usedEvents.add(ev.id);
      selections.push(sel);
    }

    if (selections.length < 2) return null;
    return {
      stake: rand(profile.stakeMin, profile.stakeMax),
      selections,
    };
  }

  if (betType === "sistema") {
    const sysType = pick(profile.systemTypes || ["2/4"]);
    const [kStr, nStr] = sysType.split("/");
    const n = parseInt(nStr, 10);

    const chosenEvents = pickN(events, n);
    const selections = [];
    const usedEvents = new Set<string>();

    for (const ev of chosenEvents) {
      if (usedEvents.has(ev.id)) continue;
      const sel = selectOutcomeFromEvent(ev, profile);
      if (!sel) continue;
      usedEvents.add(ev.id);
      selections.push(sel);
    }

    if (selections.length < n) return null;
    return {
      stake: rand(profile.stakeMin, profile.stakeMax),
      selections,
      systemType: sysType,
    };
  }

  return null;
}

async function phase4SimulateBets(
  profiles: UserProfile[],
  events: EventData[],
  state: TestState,
  round: number
): Promise<void> {
  log(`FASE 4: Round ${round} — simulazione scommesse...`);

  const initStats = (): CategoryStats => ({
    users: 0, betsPlaced: 0, betsAccepted: 0, betsPending: 0,
    betsRejected: 0, betsBlocked: 0, errors: 0,
    totalStake: 0, avgRiskScore: 0, riskScoreSum: 0,
  });

  // Initialize stats per category for this round
  if (!state.stats) state.stats = {};
  for (const cat of ["recreational", "semi_pro", "sharp", "bot", "new_account_abuser", "multi_account", "high_roller", "bonus_abuser"]) {
    if (!state.stats[cat]) state.stats[cat] = initStats();
  }

  for (const prof of profiles) {
    const userState = state.users.find(u => u.username === prof.username);
    if (!userState?.token) {
      debug(`Skip ${prof.username} — not authenticated`);
      continue;
    }

    const stats = state.stats[prof.category];
    if (round === 1) stats.users++;

    const numBets = rand(prof.betsPerRound[0], prof.betsPerRound[1]);
    debug(`${prof.username} (${prof.category}): ${numBets} bet in questo round`);

    for (let b = 0; b < numBets; b++) {
      const betData = generateBetForProfile(prof, events);
      if (!betData) {
        debug(`  ${prof.username} bet #${b + 1}: no valid selection found`);
        stats.errors++;
        continue;
      }

      if (DRY_RUN) {
        const type = betData.systemType ? `sistema ${betData.systemType}` : betData.selections.length === 1 ? "singola" : "multi";
        log(`  [DRY-RUN] ${prof.username}: ${type}, stake=$${betData.stake}, ${betData.selections.length} sel`);
        stats.betsPlaced++;
        continue;
      }

      try {
        const fp = prof.fingerprintGroup || `fp_${prof.username}`;
        const res = await fetch(`${APP_URL}/api/player/place-bet`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${userState.token}`,
          },
          body: JSON.stringify({
            stake: betData.stake,
            selections: betData.selections,
            fingerprint: fp,
            systemType: betData.systemType,
          }),
        });

        const result = await res.json();

        if (result.success) {
          stats.betsPlaced++;
          stats.totalStake += result.stake || betData.stake;
          stats.riskScoreSum += result.risk_score || 0;

          if (result.status === "open") {
            stats.betsAccepted++;
          } else if (result.status === "pending_acceptance") {
            stats.betsPending++;
          }

          const type = betData.systemType ? `sistema ${betData.systemType}` : betData.selections.length === 1 ? "singola" : "multi";
          debug(`  ${prof.username} bet #${b + 1}: ${type} ✓ id=${result.bet_id?.slice(0, 8)} risk=${result.risk_score} status=${result.status}${result.combo_count ? ` combos=${result.combo_count}` : ""}`);
        } else if (result.code === "RISK_BLOCKED") {
          stats.betsBlocked++;
          stats.betsPlaced++;
          debug(`  ${prof.username} bet #${b + 1}: BLOCKED risk=${result.risk_score}`);
        } else if (result.code === "BET_REJECTED") {
          stats.betsRejected++;
          debug(`  ${prof.username} bet #${b + 1}: REJECTED ${result.error}`);
        } else {
          stats.errors++;
          debug(`  ${prof.username} bet #${b + 1}: ERROR ${result.code} ${result.error}`);
        }
      } catch (err: any) {
        stats.errors++;
        debug(`  ${prof.username} bet #${b + 1}: EXCEPTION ${err.message}`);
      }

      // Delay between bets
      const delay = rand(prof.delayMs[0], prof.delayMs[1]);
      await sleep(delay);
    }
  }

  state.roundsCompleted = round;
  saveState(state);

  // Log round summary
  let totalBets = 0, totalAccepted = 0, totalBlocked = 0, totalPending = 0;
  for (const cat of Object.keys(state.stats)) {
    const s = state.stats[cat];
    totalBets += s.betsPlaced;
    totalAccepted += s.betsAccepted;
    totalBlocked += s.betsBlocked;
    totalPending += s.betsPending;
  }
  log(`  Round ${round} completato: ${totalBets} bet totali, ${totalAccepted} accettate, ${totalPending} pending, ${totalBlocked} bloccate`);
}

// ═══ PHASE 5: REPORT ═══

async function phase5Report(supabase: SupabaseClient, state: TestState): Promise<void> {
  log("FASE 5: Generazione report...");

  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════════");
  lines.push("  TEST AGENT REPORT");
  lines.push(`  ${new Date().toISOString()}`);
  lines.push(`  Rounds: ${state.roundsCompleted}`);
  lines.push("═══════════════════════════════════════════════════\n");

  lines.push("CATEGORIA          | USERS | BETS  | ACCEPTED | PENDING | BLOCKED | REJECTED | ERRORS | AVG RISK | STAKE");
  lines.push("─".repeat(120));

  for (const cat of ["recreational", "semi_pro", "sharp", "bot", "new_account_abuser", "multi_account", "high_roller", "bonus_abuser"]) {
    const s = state.stats[cat] || { users: 0, betsPlaced: 0, betsAccepted: 0, betsPending: 0, betsBlocked: 0, betsRejected: 0, errors: 0, totalStake: 0, riskScoreSum: 0 };
    const avgRisk = s.betsPlaced > 0 ? (s.riskScoreSum / s.betsPlaced).toFixed(1) : "0.0";
    lines.push(
      `${cat.padEnd(19)}| ${String(s.users).padStart(5)} | ${String(s.betsPlaced).padStart(5)} | ${String(s.betsAccepted).padStart(8)} | ${String(s.betsPending).padStart(7)} | ${String(s.betsBlocked).padStart(7)} | ${String(s.betsRejected).padStart(8)} | ${String(s.errors).padStart(6)} | ${avgRisk.padStart(8)} | $${s.totalStake.toFixed(0).padStart(8)}`
    );
  }

  // Query actual DB stats
  if (!DRY_RUN) {
    lines.push("\n═══ DB VERIFICATION ═══\n");

    try {
      // Count test user bets
      const testUserIds = state.users.filter(u => u.userId).map(u => u.userId!);
      if (testUserIds.length > 0) {
        const { count: betCount } = await supabase
          .from("bets")
          .select("*", { count: "exact", head: true })
          .in("user_id", testUserIds);

        const { count: parentCount } = await supabase
          .from("bets")
          .select("*", { count: "exact", head: true })
          .in("user_id", testUserIds)
          .eq("bet_type", "sistema");

        const { count: childCount } = await supabase
          .from("bets")
          .select("*", { count: "exact", head: true })
          .in("user_id", testUserIds)
          .eq("bet_type", "sistema_combo");

        const { count: flagCount } = await supabase
          .from("risk_flags")
          .select("*", { count: "exact", head: true })
          .in("user_id", testUserIds);

        const { data: blockedUsers } = await supabase
          .from("users")
          .select("username")
          .in("id", testUserIds)
          .eq("is_blocked", true);

        const { count: pendingQueue } = await supabase
          .from("bets")
          .select("*", { count: "exact", head: true })
          .in("user_id", testUserIds)
          .eq("status", "pending_acceptance");

        lines.push(`Total bets in DB:          ${betCount ?? "?"}`);
        lines.push(`  - Sistema parents:       ${parentCount ?? "?"}`);
        lines.push(`  - Sistema combos:        ${childCount ?? "?"}`);
        lines.push(`Risk flags generated:      ${flagCount ?? "?"}`);
        lines.push(`Users blocked:             ${blockedUsers?.length ?? "?"} ${blockedUsers?.map(u => u.username).join(", ") || ""}`);
        lines.push(`Bets in trading queue:     ${pendingQueue ?? "?"}`);
      }
    } catch (err: any) {
      lines.push(`DB query error: ${err.message}`);
    }
  }

  const report = lines.join("\n");
  console.log("\n" + report);

  fs.writeFileSync(REPORT_FILE, report);
  log(`Report salvato in ${REPORT_FILE}`);
}

// ═══ CLEANUP ═══

async function cleanup(supabase: SupabaseClient): Promise<void> {
  log("CLEANUP: Rimozione utenti e dati test...");

  const prefixes = [
    "rec_player_", "semipro_", "sharp_", "bot_pattern_",
    "newbie_whale_", "multi_", "vip_roller_", "bonus_hunter_",
  ];

  // Find test users
  const { data: testUsers } = await supabase
    .from("users")
    .select("id, username")
    .or(prefixes.map(p => `username.like.${p}%`).join(","));

  if (!testUsers || testUsers.length === 0) {
    log("  Nessun utente test trovato.");
    return;
  }

  log(`  Trovati ${testUsers.length} utenti test`);
  const userIds = testUsers.map(u => u.id);

  // Get bet IDs for cleanup
  const { data: bets } = await supabase
    .from("bets")
    .select("id")
    .in("user_id", userIds);
  const betIds = bets?.map(b => b.id) || [];

  // Delete in dependency order
  const steps = [
    { table: "bet_selections", filter: () => supabase.from("bet_selections").delete().in("bet_id", betIds) },
    { table: "bets (children first)", filter: () => supabase.from("bets").delete().in("user_id", userIds).not("parent_bet_id", "is", null) },
    { table: "bets (parents)", filter: () => supabase.from("bets").delete().in("user_id", userIds) },
    { table: "transactions", filter: () => supabase.from("transactions").delete().in("user_id", userIds) },
    { table: "wallets", filter: () => supabase.from("wallets").delete().in("user_id", userIds) },
    { table: "risk_flags", filter: () => supabase.from("risk_flags").delete().in("user_id", userIds) },
    { table: "risk_actions", filter: () => supabase.from("risk_actions").delete().in("entity_id", betIds) },
    { table: "login_fingerprints", filter: () => supabase.from("login_fingerprints").delete().in("user_id", userIds) },
    { table: "admin_notifications", filter: () => supabase.from("admin_notifications").delete().in("related_entity_id", betIds) },
    { table: "player_profiles", filter: () => supabase.from("player_profiles").delete().in("user_id", userIds) },
    { table: "users", filter: () => supabase.from("users").delete().in("id", userIds) },
  ];

  for (const step of steps) {
    try {
      if (step.table === "bet_selections" && betIds.length === 0) continue;
      if (step.table === "risk_actions" && betIds.length === 0) continue;
      if (step.table === "admin_notifications" && betIds.length === 0) continue;

      const { error } = await step.filter();
      if (error) {
        log(`  WARN ${step.table}: ${error.message}`);
      } else {
        debug(`  Deleted from ${step.table}`);
      }
    } catch (err: any) {
      log(`  ERROR ${step.table}: ${err.message}`);
    }
  }

  // Delete auth users
  log("  Rimozione utenti auth...");
  for (const user of testUsers) {
    try {
      const { error } = await supabase.auth.admin.deleteUser(user.id);
      if (error) {
        debug(`  WARN auth delete ${user.username}: ${error.message}`);
      }
    } catch {
      // ignore
    }
  }

  // Clean state file
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
    debug("  State file removed");
  }

  log(`  Cleanup completato: ${testUsers.length} utenti rimossi`);
}

// ═══ MAIN ═══

async function main() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  VINCITU TEST AGENT");
  console.log(`  Mode: ${DRY_RUN ? "DRY-RUN" : CLEANUP ? "CLEANUP" : `LIVE (${ROUNDS} rounds)`}`);
  console.log("═══════════════════════════════════════════════════\n");

  if (!SUPABASE_SERVICE_KEY) {
    console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY not set. Run with .env.local loaded.");
    console.error("Example: npx dotenv -e .env.local -- npx tsx scripts/test-agent.ts");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Test connection
  const { error: connErr } = await supabase.from("users").select("id", { count: "exact", head: true });
  if (connErr) {
    console.error("ERROR: Cannot connect to Supabase:", connErr.message);
    process.exit(1);
  }

  if (CLEANUP) {
    await cleanup(supabase);
    process.exit(0);
  }

  const profiles = generateProfiles();
  log(`Generati ${profiles.length} profili utente`);

  // Load or init state
  let state: TestState = loadState() || {
    phase: "init",
    users: [],
    roundsCompleted: 0,
    stats: {},
  };

  // Phase 1: Create users
  await phase1CreateUsers(supabase, profiles, state);

  // Phase 2: Authenticate
  await phase2Auth(profiles, state);

  // Rounds
  for (let round = state.roundsCompleted + 1; round <= ROUNDS; round++) {
    // Phase 3: Discover events (refresh each round)
    const events = await phase3DiscoverEvents(supabase);
    if (events.length === 0) {
      log("ERRORE: Nessun evento disponibile. Lo scraper sta girando?");
      break;
    }

    // Phase 4: Simulate bets
    await phase4SimulateBets(profiles, events, state, round);
  }

  // Phase 5: Report
  await phase5Report(supabase, state);

  log("\nTest agent completato!");
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
