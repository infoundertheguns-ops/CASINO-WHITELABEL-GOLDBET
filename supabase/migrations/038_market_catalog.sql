-- ══════════════════════════════════════════════════════════════════════
-- Migration 038 — Market Catalog (22bet dictionary + normalization)
--
-- 22bet exposes a public JSON dictionary `betsNames_full_it.js` with
-- every market group and outcome translated to Italian. We mirror it
-- into two tables so the admin can browse the catalog and so we can
-- use it as the canonical reference to normalize market names across
-- different scraper sources (Kambi, 22bet, Leon, ...).
-- ══════════════════════════════════════════════════════════════════════

-- pg_trgm for fuzzy search on names (must come before any gin_trgm_ops index).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Market groups (betsModelGroup) ───
CREATE TABLE IF NOT EXISTS twobet_market_groups (
  twobet_g        integer PRIMARY KEY,
  name_it         text    NOT NULL,
  outcome_count   integer,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_twobet_groups_name_trgm
  ON twobet_market_groups USING gin (name_it gin_trgm_ops);

-- ─── Market outcomes (betsModel) ───
CREATE TABLE IF NOT EXISTS twobet_market_outcomes (
  twobet_t           integer PRIMARY KEY,
  twobet_g           integer NOT NULL REFERENCES twobet_market_groups(twobet_g) ON DELETE CASCADE,
  name_template_it   text    NOT NULL,  -- may contain [] (team) and () (line) placeholders
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_twobet_outcomes_g ON twobet_market_outcomes (twobet_g);
CREATE INDEX IF NOT EXISTS idx_twobet_outcomes_name_trgm
  ON twobet_market_outcomes USING gin (name_template_it gin_trgm_ops);

-- ─── Cross-source normalization mapping ───
--
-- Maps raw source market_type strings to a canonical key. Each source
-- contributes its own flavor; the canonical key is the cross-source
-- identity used for consensus comparison and settlement grouping.
-- canonical_name_it can be the human-readable form (usually the 22bet one).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_normalization (
  id                  bigserial PRIMARY KEY,
  source              text NOT NULL CHECK (source IN ('kambi','22bet','leon','goldbet','ippica')),
  source_market_type  text NOT NULL,
  canonical_key       text,              -- e.g. "1x2", "correct_score", "home_over", ...
  canonical_name_it   text,              -- display name
  notes               text,
  verified            boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_market_type)
);

CREATE INDEX IF NOT EXISTS idx_market_norm_canonical ON market_normalization (canonical_key) WHERE canonical_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_norm_source    ON market_normalization (source);

-- ─── Meta table to record last successful sync ───
-- (single-row, key='twobet_catalog') so admin UI can show "Last refreshed".
-- Reuses system_config from existing schema.

COMMENT ON TABLE twobet_market_groups IS
  'Mirror of 22bet betsModelGroup dictionary (public bundle betsNames_full_it.js). Synced weekly.';
COMMENT ON TABLE twobet_market_outcomes IS
  'Mirror of 22bet betsModel dictionary — per-outcome name templates. {} = team, () = line.';
COMMENT ON TABLE market_normalization IS
  'Per-source market_type → canonical key mapping. Use 22bet dictionary as the naming reference.';
