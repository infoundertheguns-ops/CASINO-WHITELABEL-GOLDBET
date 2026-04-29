-- ═══════════════════════════════════════════════════════════
-- Migration 035 (ROLLBACK di 034): revert schema
--
-- NON applicare in flusso normale. Solo rollback d'emergenza.
-- Precondizione: TRUNCATE leagues eseguito.
--
-- Dopo questo file, eseguire MANUALMENTE:
--   psql ... -f supabase/migrations/023_league_country.sql
-- per ripristinare upsert_prematch_batch + upsert_live_batch originali.
-- ═══════════════════════════════════════════════════════════

-- 1. Drop helper function (deve precedere il drop colonne per dipendenze)
DROP FUNCTION IF EXISTS upsert_league(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

-- 2. Drop nuovo index composito
DROP INDEX IF EXISTS uq_leagues_sport_slug_dedup;

-- 3. Drop CHECK constraints
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_country_or_tour_chk;
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_country_xor_tour_chk;

-- 4. Drop nuove colonne
ALTER TABLE leagues DROP COLUMN IF EXISTS country_code;
ALTER TABLE leagues DROP COLUMN IF EXISTS tour_code;

-- 5. Ripristina vecchia UNIQUE(slug)
ALTER TABLE leagues ADD CONSTRAINT leagues_slug_key UNIQUE (slug);

-- ═══════════════════════════════════════════════════════════
-- PROCEDURA DI ROLLBACK COMPLETA (in caso di emergenza):
-- ═══════════════════════════════════════════════════════════
--
-- 1. Stop scraper:
--    ssh scraper-vps "systemctl stop kambi-scraper"
--
-- 2. Deploy vecchio scraper (commit pre-fix):
--    cd kambi-scraper && git log --oneline | head -5  -- trova commit pre-fix
--    git checkout <commit_pre_fix>
--    tar + scp + ssh install come Task 11
--
-- 3. TRUNCATE:
--    TRUNCATE outcomes, markets, events, leagues CASCADE;
--
-- 4. Applica revert schema:
--    psql ... -f 035_rollback_034.sql
--
-- 5. Ripristina RPC originali:
--    psql ... -f 023_league_country.sql
--
-- 6. Start scraper:
--    ssh scraper-vps "systemctl start kambi-scraper"
-- ═══════════════════════════════════════════════════════════
