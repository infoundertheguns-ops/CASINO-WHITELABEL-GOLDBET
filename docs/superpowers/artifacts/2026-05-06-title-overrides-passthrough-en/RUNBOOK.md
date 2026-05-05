# Title overrides per passthrough EN — 2026-05-06

## Contesto
Audit PG translation functions (post mig 175): identificati ~20k markets in `markets_v2` con `market_type` passthrough EN nel view `v_player_markets`. Frontend matching by exact name funziona ma label utente in inglese.

`TITLE_OVERRIDES_BY_SPORT` (in `lib/market-config-v2.ts`) consente override label visibile senza toccare DB.

## Gap pre-fix
- `calcio` — **NESSUN block** (~13.500 passthrough EN, sport più volume)
- `tennis` — **NESSUN block** (Set Betting 362, Totals 1st Set 267)
- `basket` — block esistente, mancano Alternative Spread/Totals, 3-Way Result HT, top O/U player
- `baseball` — block esistente, mancano First 5 Innings Totals/ML, top player O/U
- `ice-hockey` + `hockey-ghiaccio` — block esistente, mancano To Score 2+/3+ Goals, Player Shots, Points O/U

## Modifiche applicate
- **NEW** `calcio:` block con 33 entries (top passthrough EN per volume — coverage ~96%)
- **NEW** `tennis:` block con 2 entries
- **EXTEND** `basket:` block +18 entries
- **EXTEND** `baseball:` block +18 entries
- **EXTEND** `ice-hockey:` + `hockey-ghiaccio:` blocks +11 entries ciascuno

## Files modificati
- `lib/market-config-v2.ts` (1286 → 1400 LoC)

## Deploy
```bash
# VPS scraper-vps
cp /root/betssolution-player/lib/market-config-v2.ts /root/betssolution-player/lib/market-config-v2.ts.bak-pre-titles-2026-05-06
scp <local>/market-config-v2.ts scraper-vps:/root/betssolution-player/lib/
ssh scraper-vps 'cd /root/betssolution-player && export PATH="/root/.nvm/versions/node/v22.22.1/bin:$PATH" && npm run build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && [ -L .next/standalone/.env.local ] || ln -s ../../.env.local .next/standalone/.env.local && systemctl restart betssolution-player'
```

## Verifica post-deploy
- BUILD_ID: `ZXmP58R2T0AEUYSxNSAah`
- service active, health 200 (84ms)
- API smoke: sportsbook 200 (1.0s), sport-counts 200 (200ms), marcatori 200 (152ms)
- Bundle contiene tutte le nuove stringhe (`Prima Squadra a Segnare`, `Bookings Totals`, `Parate Portiere`, `Marca o Assist`, `Tripla Doppia`, `First 5 Innings`, `Vincente per Set`, `Totale Game 1° Set`, `Handicap Cartellini`, `Marcatori Multipli`)

## Risk / rollback
- Rollback: `cp /root/betssolution-player/lib/market-config-v2.ts.bak-pre-titles-2026-05-06 /root/betssolution-player/lib/market-config-v2.ts && rebuild`
- Zero DB change, zero impatto su event-v2 matching logic
- Untouched: `oddsapi_translations` table, PG functions, `_sport_slug_en_to_it`, `derive_legacy_from_v2`

## Coverage residua
**Calcio**: ~99.5% volume passthrough coperto post estensione minor (32 entries aggiunti dopo smoke test).
Skippati di proposito: Specials 576, First 10 Minutes 314, Goal Method 114, Method of Victory 69 — tutti classificati `'special'` da `classify_market_pattern`, già filtered out da `v_player_markets`.

Esports rimane non esteso (635 passthrough Map-related, low priority Tier C).

Cricket gap minore (Total Match Runs 6, To Win the Toss 17) — già coperti dal block esistente.

## Smoke test risultato
Hard refresh su Bayern Munich vs PSG (Champions League, FS-id `WzCGgkEU`, 300 markets) → utente confermato OK 2026-05-05.

## ⚠ Issue infra residuo: `.env.local` symlink
Ogni `npm run build` rigenera `.next/standalone/` ma NON ricrea il symlink `.next/standalone/.env.local → ../../.env.local`. Senza, il server parte ma falla ogni request con `Your project's URL and Key are required to create a Supabase client!`.

**Workaround manuale**: dopo OGNI rebuild, eseguire:
```bash
cd /root/betssolution-player && ln -sf ../../.env.local .next/standalone/.env.local
```

**TODO** (registry): aggiungere a `build-deploy.sh` per automatizzare. Plus copy `.next/static` + `public/` → standalone.

## Estensione finale (32 minor entries) — calcio block
Cards/Bookings: Card Handicap, Number of Cards In Match, Team Cards Home/Away, Player Cards, Player to be Booked.
Tackles: Player/Match Tackles, Team Tackles Home/Away.
Fouls: Total Fouls (Home/Away), Player Fouls, Player Fouls Committed, Player To Be Fouled.
Team shots: Match Shots (on Target), Team Shots Home/Away (on Target Home/Away).
Player props minor: Player Shots on Target Outside Box, Player Headed Shots on Target, Player Passes.
Offsides: Match Offsides, Team Offsides Home/Away.

BUILD_ID finale: `eqqz1fR3xzo3YxEz9WNsj`.
