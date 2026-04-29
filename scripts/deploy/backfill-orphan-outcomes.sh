#!/usr/bin/env bash
# Backfill script for orphan outcomes (is_active=true on ended events).
# Run from scraper-vps. Off-peak recommended but not required — uses
# batch 50k + lock_timeout 30s so concurrent scraper writes are safe.
#
# Prereq: migration 104 (trigger) applied → new ended events auto-clean.
# This script smaltisce solo lo storico snapshot, non combatte inflow.
#
# Usage:
#   PGPASSWORD=<prod-pw> bash backfill-orphan-outcomes.sh
#   PGPASSWORD=<prod-pw> bash backfill-orphan-outcomes.sh 22bet-only

set -euo pipefail

DB_HOST="${DB_HOST:-db.xgnyqkmugnfzhdveeqom.supabase.co}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
: "${PGPASSWORD:?Set PGPASSWORD env var}"
export PGPASSWORD

BATCH="${BATCH:-50000}"
FILTER="${1:-all}"

case "$FILTER" in
  22bet-only) SOURCES="22bet" ;;
  betfair-only) SOURCES="betfair" ;;
  kambi-only) SOURCES="kambi" ;;
  all|*) SOURCES="betfair 22bet" ;;  # kambi excluded — pipeline owns it
esac

total=0
for src in $SOURCES; do
  echo "=== source: $src (batch=$BATCH) ==="
  iter=0
  while :; do
    iter=$((iter+1))
    N=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tA -c "
      SET statement_timeout=0;
      SET lock_timeout='30s';
      WITH batch AS (
        SELECT o.id
          FROM outcomes o
          JOIN markets m ON m.id = o.market_id
          JOIN events e ON e.id = m.event_id
         WHERE e.source = '$src'
           AND e.status = 'ended'
           AND o.is_active = true
         LIMIT $BATCH
      )
      UPDATE outcomes
         SET is_active = false,
             is_suspended = true,
             updated_at = now()
       WHERE id IN (SELECT id FROM batch)
      RETURNING 1;
    " 2>&1 | wc -l)
    # wc adds 1 for the trailing newline
    N=$((N > 0 ? N - 1 : 0))
    TS=$(date -u +%H:%M:%S)
    total=$((total + N))
    echo "[$TS] $src iter=$iter deactivated=$N cumulative=$total"
    if [ "$N" -lt 1000 ]; then
      echo "[$TS] $src: done (residual batch < 1000)"
      break
    fi
  done
done

echo "=== Total deactivated: $total ==="
