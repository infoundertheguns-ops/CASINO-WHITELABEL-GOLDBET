# Task 19 — Deploy Phase 2 GO-LIVE (flag=calcio)

**Date**: 2026-05-03 ~15:09 UTC

## Pre-deploy
- Backup: `/root/betssolution-player/.env.local.bak-pre-eventv2-go-live-20260503-150842`
- Phase 1 status: SAFE (Task 18 commit `6bbe5b9`)
- Flag transition: `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=` (empty) → `=calcio`

## Build
- Compile time: 11.7s (real), 43.4s (user CPU)
- Static pages: standalone build successful (all routes generated)
- Errors: none

## Service
- New PID: 11829
- Memory: 90.4MB (peak 94.4MB)
- Active since: 2026-05-03 15:09:08 UTC
- Logs: `Next.js 16.2.0`, `Ready in 0ms`, no errors/warnings post-restart

## Smoke results
- Calcio event V2 markers in HTML: not testable via curl (kiosk middleware → 307 /login)
  - Must be verified by user in real browser session
- Calcio event endpoint: 200/307 (auth gate), 16ms
- Other sports event pages: all 307 (auth gate, fast 2-4ms — middleware-level redirect, no app render attempted)
- Listing endpoints all sports (status 200):
  - calcio: 421ms
  - tennis: 147ms
  - basket: 225ms
  - pallamano: 202ms
  - hockey-ghiaccio: 192ms
  - rugby: 118ms
- /api/health: 200 30ms `{"db":"ok"}`
- Latencies: all <500ms, comparable to pre-deploy baseline

## Rollback procedure
```bash
ssh scraper-vps 'sed -i "s/^NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=.*/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=/" /root/betssolution-player/.env.local && source ~/.nvm/nvm.sh && cd /root/betssolution-player && npm run build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local && systemctl restart betssolution-player'
```

## Conclusion
- [x] V2 LIVE for calcio sport (build complete with flag baked, service active, no errors)
- [x] No regression on other sports (all listing 200 <500ms, event pages 307 auth as before)
- [ ] Manual visual smoke needed by user (browser at 1920x1080) — kiosk auth blocks headless curl
