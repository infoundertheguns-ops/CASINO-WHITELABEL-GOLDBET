# Event Page V2 (calcio) — monitoring runbook

**Activated**: 2026-05-03 ~15:09 UTC (Task 19 commit 0409871)
**Window**: 1-2 settimane attive monitoring

## Daily check (5 min)

```bash
ssh scraper-vps 'systemctl is-active betssolution-player && journalctl -u betssolution-player --since "24 hours ago" --no-pager | grep -iE "(error|exception|FATAL|event-v2|page-v2)" | head -20'
```

Expected: `active`, zero or few errors. Investigate any error mentioning event-v2 or page-v2.

## Performance check (weekly)

```bash
ssh scraper-vps 'for sport in calcio tennis basket pallamano hockey-ghiaccio rugby; do curl -sS -o /dev/null -w "$sport: %{http_code} %{time_total}s\n" "http://127.0.0.1:3001/api/sportsbook?sport=$sport&status=prematch&limit=10"; done'
```

Compare to baseline (Task 18/19 deploy notes):
- calcio listing: ~440ms cold, <100ms warm
- other sports: 100-250ms

## Memory monitoring

```bash
ssh scraper-vps 'systemctl show betssolution-player -p MemoryCurrent -p MemoryPeak -p NRestarts'
```

Baseline post Task 19: 90MB current, 94MB peak, 0 restarts.

## Rollback if needed

```bash
ssh scraper-vps '
cp /root/betssolution-player/.env.local /root/betssolution-player/.env.local.bak-rollback-$(date +%Y%m%d-%H%M%S) &&
sed -i "s/^NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=.*/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=/" /root/betssolution-player/.env.local &&
source ~/.nvm/nvm.sh && cd /root/betssolution-player &&
npm run build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ &&
ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local &&
systemctl restart betssolution-player'
```

## Cleanup post-monitoring (after 30d clean)

- Remove backup files: `/root/betssolution-player/.env.local.bak-pre-eventv2*`
- Remove backup file: `/root/betssolution-player/app/(kiosk)/event/[eventId]/page.tsx.bak-pre-eventv2-*`
- Plan B v2.1 (other sports) brainstorms can begin
