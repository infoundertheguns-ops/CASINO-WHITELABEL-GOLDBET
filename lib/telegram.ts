// ═══ TELEGRAM ALERT SYSTEM ═══
// Centralized alert with levels, cooldown, state tracking, and transition detection.

const TELEGRAM_API = "https://api.telegram.org";

// ═══ TYPES ═══

export type AlertLevel = "info" | "warning" | "critical" | "recovery";

interface AlertState {
  level: AlertLevel | "healthy";
  since: string;
  lastScore: number;
}

// ═══ CONFIG ═══

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  info: "\u2139\ufe0f",
  warning: "\u26a0\ufe0f",
  critical: "\ud83d\udd34",
  recovery: "\u2705",
};

const COOLDOWN_MS: Record<AlertLevel, number> = {
  critical: 2 * 60 * 1000,    // 2 min
  warning: 10 * 60 * 1000,    // 10 min
  info: 60 * 60 * 1000,       // 60 min
  recovery: 2 * 60 * 1000,    // 2 min
};

// ═══ STATE TRACKING (globalThis — survives module re-evaluation) ═══

const g = globalThis as any;
if (!g.__telegramAlertState) g.__telegramAlertState = new Map<string, AlertState>();
if (!g.__telegramCooldowns) g.__telegramCooldowns = new Map<string, number>();

const alertState: Map<string, AlertState> = g.__telegramAlertState;
const cooldowns: Map<string, number> = g.__telegramCooldowns;

// ═══ HELPERS ═══

function getBotToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

function getChatId(): string {
  return process.env.TELEGRAM_CHAT_ID || "";
}

function romaTime(): string {
  return new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" });
}

function formatMessage(level: AlertLevel, header: string, body: string): string {
  const emoji = LEVEL_EMOJI[level];
  return `${emoji} <b>${header}</b>\n\n${body}\n\n\ud83d\udd50 ${romaTime()}`;
}

// ═══ CORE SEND (with cooldown) ═══

async function sendRaw(text: string): Promise<boolean> {
  const token = getBotToken();
  const chatId = getChatId();
  if (!token || !chatId) {
    console.warn("[TELEGRAM] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return false;
  }

  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (resp.ok) return true;
    const err = await resp.text().catch(() => "");
    console.error(`[TELEGRAM] API error ${resp.status}: ${err}`);
    return false;
  } catch (err) {
    console.error(`[TELEGRAM] Send failed: ${err}`);
    return false;
  }
}

/**
 * Send an alert with cooldown per key+level.
 * Returns true if sent, false if skipped (cooldown) or failed.
 */
export async function sendTelegramAlert(
  level: AlertLevel,
  header: string,
  body: string,
  alertKey: string
): Promise<boolean> {
  const cooldownKey = `${alertKey}:${level}`;
  const now = Date.now();
  const lastSent = cooldowns.get(cooldownKey) || 0;
  const cooldownMs = COOLDOWN_MS[level];

  if (now - lastSent < cooldownMs) {
    return false; // still in cooldown
  }

  const message = formatMessage(level, header, body);
  const sent = await sendRaw(message);
  if (sent) {
    cooldowns.set(cooldownKey, now);
  }
  return sent;
}

/**
 * Send a Telegram message without any cooldown (for bets, one-off messages).
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  return sendRaw(text);
}

// ═══ CONVENIENCE HELPERS ═══

export function alertCritical(header: string, body: string, key: string) {
  return sendTelegramAlert("critical", header, body, key);
}

export function alertWarning(header: string, body: string, key: string) {
  return sendTelegramAlert("warning", header, body, key);
}

export function alertInfo(header: string, body: string, key: string) {
  return sendTelegramAlert("info", header, body, key);
}

export function alertRecovery(header: string, body: string, key: string) {
  return sendTelegramAlert("recovery", header, body, key);
}

// ═══ STATE MACHINE — transition-based alerts ═══

/**
 * Get current alert state for a key.
 */
export function getAlertState(key: string): AlertState | undefined {
  return alertState.get(key);
}

/**
 * Update alert state and send alert ONLY on transitions.
 * Returns true if an alert was sent.
 *
 * Logic:
 * - healthy → critical/warning = send alert
 * - critical → critical (same level) = no alert (already notified)
 * - critical/warning → healthy = send RECOVERY
 * - warning → critical = send CRITICAL (escalation)
 * - critical → warning = no alert (still degraded)
 */
export async function checkAndTransition(
  key: string,
  score: number,
  criticalThreshold: number,
  warningThreshold: number,
  healthyThreshold: number,
  label: string
): Promise<boolean> {
  const prev = alertState.get(key) || { level: "healthy", since: new Date().toISOString(), lastScore: 100 };

  let newLevel: AlertState["level"];
  if (score < criticalThreshold) {
    newLevel = "critical";
  } else if (score < warningThreshold) {
    newLevel = "warning";
  } else if (score >= healthyThreshold) {
    newLevel = "healthy";
  } else {
    // Between warning and healthy threshold — keep current state
    newLevel = prev.level === "healthy" ? "healthy" : prev.level;
  }

  // Update state
  if (newLevel !== prev.level) {
    alertState.set(key, { level: newLevel, since: new Date().toISOString(), lastScore: score });
  } else {
    alertState.set(key, { ...prev, lastScore: score });
  }

  // Determine if we should send an alert
  let sent = false;

  if (newLevel === "critical" && prev.level !== "critical") {
    // Transition to critical (from healthy or warning)
    sent = await alertCritical(
      `${label} CRITICO`,
      `Score: ${score}/100\nStato precedente: ${prev.level} (${prev.lastScore}/100)`,
      key
    );
  } else if (newLevel === "warning" && prev.level === "healthy") {
    // Transition to warning from healthy
    sent = await alertWarning(
      `${label} DEGRADATO`,
      `Score: ${score}/100`,
      key
    );
  } else if (newLevel === "healthy" && (prev.level === "critical" || prev.level === "warning")) {
    // Recovery
    sent = await alertRecovery(
      `${label} RECUPERATO`,
      `Score: ${score}/100\nEra ${prev.level} da ${prev.since}`,
      key
    );
  }

  return sent;
}

/**
 * Simple up/down transition check (for binary states like "scraper producing data or not").
 * Returns true if an alert was sent.
 */
export async function checkBinaryTransition(
  key: string,
  isUp: boolean,
  label: string,
  downBody: string,
  upBody: string
): Promise<boolean> {
  const prev = alertState.get(key) || { level: "healthy", since: new Date().toISOString(), lastScore: 100 };

  const newLevel: AlertState["level"] = isUp ? "healthy" : "warning";

  if (newLevel !== prev.level) {
    alertState.set(key, { level: newLevel, since: new Date().toISOString(), lastScore: isUp ? 100 : 0 });
  }

  let sent = false;

  if (!isUp && prev.level === "healthy") {
    sent = await alertWarning(`${label} DOWN`, downBody, key);
  } else if (isUp && (prev.level === "warning" || prev.level === "critical")) {
    sent = await alertRecovery(`${label} RECOVERED`, `${upBody}\nEra down da ${prev.since}`, key);
  }

  return sent;
}
