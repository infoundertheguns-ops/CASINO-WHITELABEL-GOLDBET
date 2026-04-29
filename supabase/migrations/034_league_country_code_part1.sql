-- ═══════════════════════════════════════════════════════════
-- Migration 034 Part 1: Aggiungi country_code + tour_code a leagues
-- CHECK constraints come NOT VALID (dati esistenti hanno NULL in entrambi).
-- Part 2 (VALIDATE + INDEX + RPC) va eseguito DOPO il TRUNCATE.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE leagues
  ADD COLUMN country_code VARCHAR(32),
  ADD COLUMN tour_code    VARCHAR(32);

-- Almeno uno dei due deve essere popolato (validato solo su INSERT futuri fino a VALIDATE)
ALTER TABLE leagues ADD CONSTRAINT leagues_country_or_tour_chk
  CHECK (country_code IS NOT NULL OR tour_code IS NOT NULL) NOT VALID;

-- Mutua esclusione (XOR): una lega è country-based O tour-based, non entrambi
ALTER TABLE leagues ADD CONSTRAINT leagues_country_xor_tour_chk
  CHECK (NOT (country_code IS NOT NULL AND tour_code IS NOT NULL)) NOT VALID;

COMMENT ON COLUMN leagues.country_code IS
  'Kambi country slug (es. iraq, italy, usa). NULL se lega è tour-based.';
COMMENT ON COLUMN leagues.tour_code IS
  'Kambi tour/organization slug (es. atp, pga-tour, formula-1). NULL se lega è country-based.';
