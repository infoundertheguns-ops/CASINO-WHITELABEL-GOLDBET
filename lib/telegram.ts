// ═══ TELEGRAM ALERT UTILITY ═══

const TELEGRAM_API = "https://api.telegram.org";

function getBotToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

function getChatId(): string {
  return process.env.TELEGRAM_CHAT_ID || "";
}

// Rate limit: track last send time per alert key
const lastSentMap = new Map<string, number>();
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Send a Telegram message. Rate-limited by alertKey (max 1 per 10 min per key).
 * Returns true if sent, false if skipped (cooldown) or failed.
 */
export async function sendTelegramAlert(
  message: string,
  alertKey: string = "default"
): Promise<boolean> {
  const token = getBotToken();
  const chatId = getChatId();

  if (!token || !chatId) {
    console.warn("[TELEGRAM] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return false;
  }

  // Check cooldown
  const lastSent = lastSentMap.get(alertKey) || 0;
  if (Date.now() - lastSent < COOLDOWN_MS) {
    return false; // Still in cooldown
  }

  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });

    if (resp.ok) {
      lastSentMap.set(alertKey, Date.now());
      return true;
    }

    const err = await resp.text().catch(() => "");
    console.error(`[TELEGRAM] API error ${resp.status}: ${err}`);
    return false;
  } catch (err) {
    console.error(`[TELEGRAM] Send failed: ${err}`);
    return false;
  }
}
