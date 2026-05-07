export const ENRICHMENT_KEYS = [
  "stats",
  "lineups",
  "incidents",
  "momentum",
  "shotmap",
  "best_players",
  "highlights",
  "comments",
  "votes",
  "featured_players",
] as const;

export type EnrichmentKey = (typeof ENRICHMENT_KEYS)[number];

export type EnrichmentPayload = Partial<Record<EnrichmentKey, unknown | null>>;

export interface EndpointStatus {
  ok: boolean;
  http: number;
  size: number;
  ts: string;
}

/**
 * Build the SQL UPDATE/INSERT column set from an enrichment payload.
 * - keys explicitly present in input (including null) → include in output
 * - keys absent (undefined) → omit (preserve existing column value on update)
 */
export function buildPartialUpsert(
  payload: EnrichmentPayload
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ENRICHMENT_KEYS) {
    if (k in payload) out[k] = payload[k] ?? null;
  }
  return out;
}

/**
 * Merge new endpoint status onto prior, key-by-key.
 * Untouched endpoints retain their prior status.
 */
export function mergeEndpointStatus(
  prior: Record<string, EndpointStatus>,
  next: Record<string, EndpointStatus>
): Record<string, EndpointStatus> {
  return { ...prior, ...next };
}
