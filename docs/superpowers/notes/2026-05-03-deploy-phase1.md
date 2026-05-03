# Task 18 — Deploy Phase 1 (flag empty)

**Date**: 2026-05-03 ~15:04 UTC

## Pre-state
- Flag value before: absent (= empty)
- Service status pre-deploy: active (PID pre 8892)
- Backup created: `/root/betssolution-player/.env.local.bak-pre-eventv2-20260503-150418`

## Build output
- Compile time: ~2.5s (Next 16.2.0)
- Build completed without errors
- Standalone size: 210M
- All dynamic routes generated, including `/event/[eventId]` and `/api/sportsbook`

## Deploy steps executed
- `npm run build` OK
- `cp -r .next/static .next/standalone/.next/` OK
- `cp -r public .next/standalone/` OK
- `ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local` OK (symlink critico per NEXT_PUBLIC_READ_FROM_V2 + flag)
- `systemctl restart betssolution-player` OK
- New PID 8892, ready in 0ms, MemoryCurrent ~63MB

## Smoke results
- `/api/health`: 200, 127ms
- `/api/sportsbook?sport=calcio`: 200, 442ms (cold)
- `/api/sportsbook?sport=tennis`: 200, 125ms
- `/api/sportsbook?sport=basket`: 200, 210ms
- `/api/sportsbook?sport=pallamano`: 200, 173ms
- `/api/sportsbook?sport=hockey-ghiaccio`: 200, 186ms
- `/api/sportsbook?sport=rugby`: 200, 109ms
- Event detail page (calcio EID `fe80a7d7-df1e-4fe8-bbc4-7ce70d4ac0d7`): 307 redirect to `/login` (expected — kiosk auth-protected, middleware funzionante)
- Final HTML (login page) v2 markers count: **0** (expected — flag empty, V2 dead code)

## Service health
- Status: `active`
- ActiveEnter: 2026-05-03 15:04:41 UTC
- Memory: 63MB (well under 512M MemoryMax)
- No errors/warnings in journalctl since restart
- Pre-restart "Failed with exit-code 143" = SIGTERM (graceful shutdown), normal

## Conclusion
- [x] Phase 1 deploy SAFE — legacy path invariato
- [x] V2 code shipped on disk but inert (flag empty)
- [x] Ready for Phase 2 (Task 19) flag=calcio enable

## Rollback procedure (if needed)
```bash
cp /root/betssolution-player/.env.local.bak-pre-eventv2-20260503-150418 /root/betssolution-player/.env.local
systemctl restart betssolution-player
```
Or simply leave flag empty — V2 path remains dead code.
