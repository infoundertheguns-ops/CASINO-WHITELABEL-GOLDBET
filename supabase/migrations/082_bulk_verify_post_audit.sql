-- 082_bulk_verify_post_audit.sql
-- Post-audit bulk-verify: promote all auto-regex/dictionary/propagation
-- mappings to verified=true. Audit performed in Wave 31 found 0.4% mismap
-- rate (3 classes, 253 rows) — all fixed. Residual auto-mappings are safe
-- to promote en masse.

UPDATE market_normalization
SET verified=true, updated_at=now()
WHERE canonical_key IS NOT NULL
  AND extracted_by IN ('regex', 'dictionary', 'propagation')
  AND verified=false;
