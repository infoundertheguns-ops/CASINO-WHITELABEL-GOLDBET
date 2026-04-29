#!/usr/bin/env bash
# scripts/db/apply-migration.sh
#
# Apply a SQL migration to staging or production Supabase.
# Tracks applied migrations in public._migrations to prevent re-application.
#
# Usage:
#   apply-migration.sh --target staging|prod --file path/to/migration.sql
#   apply-migration.sh --target staging --dir supabase/migrations
#   apply-migration.sh --target staging --status         # list applied migrations
#
# Required env (or pass via --env-file):
#   STAGING_DB_HOST, STAGING_DB_PASSWORD, PROD_DB_HOST, PROD_DB_PASSWORD

set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PSQL="$PG_BIN/psql"

usage() {
  sed -n '1,15p' "$0" | sed 's/^# //;s/^#//'
  exit 1
}

TARGET=""
FILE=""
DIR=""
STATUS=0
ENV_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --status) STATUS=1; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1"; usage ;;
  esac
done

[ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

case "$TARGET" in
  staging)
    DB_HOST="${STAGING_DB_HOST:?missing STAGING_DB_HOST}"
    DB_PASSWORD="${STAGING_DB_PASSWORD:?missing STAGING_DB_PASSWORD}"
    ;;
  prod|production)
    DB_HOST="${PROD_DB_HOST:?missing PROD_DB_HOST}"
    DB_PASSWORD="${PROD_DB_PASSWORD:?missing PROD_DB_PASSWORD}"
    if [ "$STATUS" = "0" ]; then
      echo "⚠️  Applying migration to PRODUCTION ($DB_HOST)"
      read -r -p "Type 'yes' to confirm: " CONFIRM
      [ "$CONFIRM" = "yes" ] || { echo "aborted"; exit 1; }
    fi
    ;;
  *)
    echo "FATAL: --target must be staging or prod"
    exit 1
    ;;
esac

DB_URL="postgresql://postgres:${DB_PASSWORD}@${DB_HOST}:5432/postgres"

# Ensure tracking table exists
PGPASSWORD="$DB_PASSWORD" "$PSQL" "$DB_URL" -q -c "
  CREATE TABLE IF NOT EXISTS public._migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sha256 TEXT,
    notes TEXT
  );" >/dev/null

if [ "$STATUS" = "1" ]; then
  echo "Applied migrations on $TARGET ($DB_HOST):"
  PGPASSWORD="$DB_PASSWORD" "$PSQL" "$DB_URL" -c "SELECT name, applied_at FROM public._migrations ORDER BY applied_at;"
  exit 0
fi

apply_one() {
  local f="$1"
  local name
  name=$(basename "$f")
  local sha
  sha=$(sha256sum "$f" | cut -d' ' -f1)

  local already
  already=$(PGPASSWORD="$DB_PASSWORD" "$PSQL" "$DB_URL" -t -A -c "SELECT sha256 FROM public._migrations WHERE name='$name';")
  if [ -n "$already" ]; then
    if [ "$already" = "$sha" ]; then
      echo "  ⏭  $name (already applied, sha matches)"
      return 0
    else
      echo "  ⚠️  $name already applied with DIFFERENT sha. Local=$sha, DB=$already. Skipping (manually review)."
      return 1
    fi
  fi

  echo "  ▶  $name (sha=${sha:0:8})"
  PGPASSWORD="$DB_PASSWORD" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
  PGPASSWORD="$DB_PASSWORD" "$PSQL" "$DB_URL" -c "INSERT INTO public._migrations(name, sha256) VALUES ('$name', '$sha');" >/dev/null
  echo "  ✓  $name done"
}

if [ -n "$FILE" ]; then
  [ -f "$FILE" ] || { echo "file not found: $FILE"; exit 1; }
  apply_one "$FILE"
elif [ -n "$DIR" ]; then
  [ -d "$DIR" ] || { echo "dir not found: $DIR"; exit 1; }
  for f in $(ls "$DIR"/*.sql 2>/dev/null | sort); do
    apply_one "$f"
  done
else
  usage
fi

echo "Done."
