import type { CanonicalMarket, Source } from "./types";

// Stage 5 of the normalization engine: LLM-based classification for the
// long-tail of market_types regex + dictionary + propagation didn't cover.
// Uses Claude Haiku 4.5 via direct fetch (same pattern as lib/risk/engine.ts).
// Caches the canonical catalog in the system prompt for cost reduction.

export interface LookupLLMArgs {
  batch: string[];
  canonicals: CanonicalMarket[];
  source: Source;
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}

export interface LLMMatch {
  input: string;
  canonical_key: string | null;
  canonical_line: number | null;
  confidence: number;
  reasoning?: string;
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface LookupLLMResult {
  matches: LLMMatch[];
  usage?: LLMUsage;
}

export const DEFAULT_LLM_MODEL = "claude-haiku-4-5-20251001";
export const MAX_LLM_CONFIDENCE = 85; // below regex's 95 since LLM is non-deterministic

// Exported for testing. Injectable fetch override for mocking.
export type FetchFn = typeof fetch;

export async function lookupLLM(
  args: LookupLLMArgs,
  fetchImpl: FetchFn = fetch,
): Promise<LookupLLMResult> {
  const { batch, canonicals, source, apiKey } = args;
  const model = args.model ?? DEFAULT_LLM_MODEL;

  if (batch.length === 0) return { matches: [] };
  if (!apiKey) throw new Error("lookupLLM: apiKey is required");

  const catalog = canonicals.map((c) => ({
    key: c.canonical_key,
    name: c.canonical_name_it,
    period: c.period,
    has_line: c.has_line,
    base: c.base_key,
  }));

  const systemPrompt = `Sei un classificatore esperto di mercati di scommesse sportive. Mappa ogni stringa market_type dal bookmaker ${source} al canonical_key più appropriato dal CATALOGO qui sotto.

CATALOGO:
${JSON.stringify(catalog, null, 2)}

REGOLE:
- canonical_key DEVE essere una key esatta del catalogo, o null se nessuna combacia.
- canonical_line: numero estratto dalla stringa (es. "U/O 2.5" → 2.5) SE il canonical ha has_line=true. Altrimenti null.
- confidence: integer 0-${MAX_LLM_CONFIDENCE}. Non superare ${MAX_LLM_CONFIDENCE}. Usa valori alti (70+) solo quando sei molto sicuro.
- reasoning: 1 frase breve in italiano che spiega la scelta.
- Per player props ("Segna [nome]", "Tiri di [nome]"), cerca canonical generici; se non esiste, ritorna null con reasoning.
- Per combo esotici non riconoscibili, ritorna null invece di forzare un match sbagliato.

OUTPUT: SOLO JSON valido nella forma {"matches":[...]}, nessun testo extra, nessun markdown.`;

  const userPrompt = `Classifica questi ${batch.length} market_type da ${source}:
${batch.map((s, i) => `${i + 1}. ${JSON.stringify(s)}`).join("\n")}

Ritorna l'array "matches" con un oggetto per ogni input, nello stesso ordine. Campi obbligatori: input (stringa originale), canonical_key, canonical_line, confidence, reasoning.`;

  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    signal: args.signal,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const body: any = await res.json();
  const content: string = body?.content?.[0]?.text ?? "";

  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: { matches?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.matches)) {
    throw new Error("LLM response missing matches[] array");
  }

  const catalogKeys = new Set(canonicals.map((c) => c.canonical_key));
  const validMatches: LLMMatch[] = [];

  for (const raw of parsed.matches as any[]) {
    const m: LLMMatch = {
      input: String(raw?.input ?? ""),
      canonical_key: raw?.canonical_key ?? null,
      canonical_line: raw?.canonical_line == null ? null : Number(raw.canonical_line),
      confidence: Math.max(0, Math.min(MAX_LLM_CONFIDENCE, Math.round(Number(raw?.confidence) || 0))),
      reasoning: typeof raw?.reasoning === "string" ? raw.reasoning : undefined,
    };

    // Reject hallucinated canonical_key (not in catalog).
    if (m.canonical_key != null && !catalogKeys.has(m.canonical_key)) {
      m.reasoning = `[hallucinated ${m.canonical_key}] ${m.reasoning ?? ""}`.trim();
      m.canonical_key = null;
      m.canonical_line = null;
      m.confidence = 0;
    }

    // Safety: if no canonical_key, force line to null and confidence to 0
    if (m.canonical_key == null) {
      m.canonical_line = null;
      m.confidence = 0;
    }

    validMatches.push(m);
  }

  return {
    matches: validMatches,
    usage: body?.usage,
  };
}
