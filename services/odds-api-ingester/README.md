# odds-api-ingester

Ingests events + odds from odds-api.io REST v3 into Supabase `events_v2` / `markets_v2` / `outcomes_v2`.
Replaces kambi / 22bet / betfair scrapers (see `docs/superpowers/specs/2026-04-28-odds-api-io-migration-design.md`).

## Setup

```bash
cp .env.example .env
# fill in ODDS_API_KEY and SUPABASE_SERVICE_ROLE
npm install
```

## Run POC (Italian Serie A only, one-shot)

```bash
npm run poc:serie-a
```

## Verify

```bash
npm run smoke
```

## Test

```bash
npm test
```
