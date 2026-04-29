-- Migration 041: widen ippica_races.prize_amount from INTEGER to BIGINT
--
-- MST channel returns prize_amount in euro cents for some major races
-- (Grand Prix de Saint-Cloud etc.) which exceeds INTEGER max (2^31-1 = 2147483647).
-- Observed in scraper log: "value '2154750000' is out of range for type integer"
-- on race mst:1445820. Widening to BIGINT gives ~9.2 × 10^18 headroom.

ALTER TABLE ippica_races ALTER COLUMN prize_amount TYPE BIGINT;

-- No data migration needed: all existing INT values fit BIGINT.
