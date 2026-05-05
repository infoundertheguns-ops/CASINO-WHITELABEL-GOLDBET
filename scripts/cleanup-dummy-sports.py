#!/usr/bin/env python3
"""
Cleanup dummy events created by seed-dummy-sports.py.
Run when smoke testing is complete.

Deletes (in order):
  1. outcomes_v2 → cascades from markets_v2 (assumed)
  2. markets_v2 → cascades from events_v2 (assumed)
  3. events_v2 (filter on league_slug LIKE 'QA-DUMMY-%')
  4. legacy outcomes → cascades from markets
  5. legacy markets → cascades from events
  6. legacy events (joined to leagues with slug LIKE 'QA-DUMMY-%')
  7. legacy leagues (slug LIKE 'QA-DUMMY-%')
"""
import urllib.request, json, os, sys

KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
assert KEY and URL, "missing supabase creds (env)"

HEADERS = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json', 'Prefer': 'return=representation'}

def req(method, path):
    full_url = f'{URL}/rest/v1/{path}'
    r = urllib.request.Request(full_url, headers=HEADERS, method=method)
    try:
        body = urllib.request.urlopen(r).read()
        return json.loads(body) if body else []
    except urllib.error.HTTPError as e:
        print(f'  HTTP {e.code} on {method} {path}: {e.read().decode()[:200]}', file=sys.stderr)
        return None

# 1. find dummy event ids from events_v2
events_v2 = req('GET', "events_v2?select=id&league_slug=like.QA-DUMMY-%25")
event_ids_v2 = [e['id'] for e in (events_v2 or [])]
print(f'Found {len(event_ids_v2)} dummy events in events_v2')

# 2. find dummy league ids
leagues = req('GET', "leagues?select=id&slug=like.QA-DUMMY-%25")
league_ids = [l['id'] for l in (leagues or [])]
print(f'Found {len(league_ids)} dummy leagues')

# 3. find legacy event ids by league_id
legacy_event_ids = set(event_ids_v2)  # same ids by construction
if league_ids:
    legacy_events = req('GET', f"events?select=id&league_id=in.({','.join(league_ids)})")
    for e in (legacy_events or []):
        legacy_event_ids.add(e['id'])
print(f'Total legacy event ids to delete: {len(legacy_event_ids)}')

if not legacy_event_ids:
    print('Nothing to delete.')
    sys.exit(0)

# 4. delete outcomes_v2 → markets_v2 → events_v2
ids_in = ','.join(legacy_event_ids)
markets_v2_rows = req('GET', f"markets_v2?select=id&event_id=in.({ids_in})")
market_ids_v2 = [m['id'] for m in (markets_v2_rows or [])]
print(f'  outcomes_v2: deleting via {len(market_ids_v2)} markets')
if market_ids_v2:
    req('DELETE', f"outcomes_v2?market_id=in.({','.join(market_ids_v2)})")
    req('DELETE', f"markets_v2?id=in.({','.join(market_ids_v2)})")
print(f'  events_v2: deleting {len(event_ids_v2)} rows')
if event_ids_v2:
    req('DELETE', f"events_v2?id=in.({','.join(event_ids_v2)})")

# 5. delete legacy outcomes → markets → events
legacy_markets = req('GET', f"markets?select=id&event_id=in.({ids_in})")
legacy_market_ids = [m['id'] for m in (legacy_markets or [])]
print(f'  legacy outcomes: deleting via {len(legacy_market_ids)} markets')
if legacy_market_ids:
    req('DELETE', f"outcomes?market_id=in.({','.join(legacy_market_ids)})")
    req('DELETE', f"markets?id=in.({','.join(legacy_market_ids)})")
print(f'  legacy events: deleting {len(legacy_event_ids)} rows')
req('DELETE', f"events?id=in.({ids_in})")

# 6. delete legacy leagues
print(f'  leagues: deleting {len(league_ids)} rows')
if league_ids:
    req('DELETE', f"leagues?id=in.({','.join(league_ids)})")

# 7. verify
remaining = req('GET', "events_v2?select=count&league_slug=like.QA-DUMMY-%25")
print(f'\n✅ Cleanup complete. Remaining QA-DUMMY events_v2: {len(remaining or [])}')
