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
~4% volume passthrough calcio non coperto (Specials 576 → filtered 'special'; First 10 Minutes 314 → filtered 'special'; Goal Method 114 → filtered 'special'; minor markets <50 events). Volutamente skippati.

Esports rimane non esteso (635 passthrough Map-related, low priority Tier C).

Cricket gap minore (Total Match Runs 6, To Win the Toss 17) — già coperti dal block esistente.
