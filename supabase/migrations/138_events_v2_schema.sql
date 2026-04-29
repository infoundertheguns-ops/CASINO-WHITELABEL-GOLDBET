-- Migration 138: events_v2 / markets_v2 / outcomes_v2 — odds-api.io ingestion schema.
--
-- Context: Phase 0 POC of odds-api.io migration (spec
-- docs/superpowers/specs/2026-04-28-odds-api-io-migration-design.md). The
-- existing events / markets / outcomes tables encode source-specific external_ids
-- and rely on the canonicalization + normalization pipeline to reconcile data
-- across kambi / 22bet / betfair scrapers. odds-api.io ships pre-normalized,
-- ID-stable data, so we introduce a parallel v2 schema that the new
-- odds-api-ingester service writes to. v1 tables remain untouched during POC
-- and Phase 1 staging validation.
--
-- Tables:
--   events_v2   — one row per provider event (odds_api_id stable)
--   markets_v2  — one row per (event, bookmaker, market_name)
--   outcomes_v2 — one row per outcome line within a market
--
-- Key choices:
--   - odds_api_id (bigint) is the natural unique key from the provider.
--   - league_slug / sport_slug are stable provider identifiers; we keep names
--     as denormalized text alongside (cheap, avoids a leagues_v2 table for now).
--   - period_scores is jsonb verbatim from the API (varies by sport: fulltime,
--     p1, p2, set1, q1, etc.) — scoreboard dispatcher unpacks per-sport.
--   - flashscore_id is OPTIONAL (settlement enrichment fallback only).
--   - outcomes_v2 unique constraint includes nullable `line`. Postgres treats
--     NULL as not-equal in UNIQUE, so two ML rows (line IS NULL) for the same
--     market/outcome could in principle coexist. Acceptable for POC since
--     repeated upserts produce identical rows; if observed in practice we
--     replace with an expression unique index using COALESCE(line, sentinel).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Rollback: DROP TABLE outcomes_v2, markets_v2, events_v2 CASCADE.

BEGIN;

CREATE TABLE IF NOT EXISTS public.events_v2 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  odds_api_id     bigint NOT NULL UNIQUE,
  home            text   NOT NULL,
  away            text   NOT NULL,
  home_id         bigint,
  away_id         bigint,
  starts_at       timestamptz NOT NULL,
  sport_slug      text   NOT NULL,
  sport_name      text   NOT NULL,
  league_slug     text   NOT NULL,
  league_name     text   NOT NULL,
  status          text   NOT NULL CHECK (status IN ('pending','live','settled','cancelled','postponed')),
  score_home      int,
  score_away      int,
  period_scores   jsonb,
  flashscore_id   text,
  urls            jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_v2_sport_starts ON public.events_v2(sport_slug, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_v2_status_starts ON public.events_v2(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_v2_league ON public.events_v2(league_slug);

CREATE TABLE IF NOT EXISTS public.markets_v2 (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES public.events_v2(id) ON DELETE CASCADE,
  bookmaker             text NOT NULL,
  market_name           text NOT NULL,
  odds_api_updated_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, bookmaker, market_name)
);

CREATE INDEX IF NOT EXISTS idx_markets_v2_event ON public.markets_v2(event_id);

CREATE TABLE IF NOT EXISTS public.outcomes_v2 (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     uuid NOT NULL REFERENCES public.markets_v2(id) ON DELETE CASCADE,
  outcome_key   text NOT NULL,
  line          numeric,
  odds          numeric NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  is_suspended  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_id, outcome_key, line)
);

CREATE INDEX IF NOT EXISTS idx_outcomes_v2_market ON public.outcomes_v2(market_id);

COMMIT;
