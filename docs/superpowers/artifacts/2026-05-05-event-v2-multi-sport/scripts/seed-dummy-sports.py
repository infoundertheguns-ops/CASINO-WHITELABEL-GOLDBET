#!/usr/bin/env python3
"""
Seed dummy events for v2 multi-sport smoke test.

Creates per sport:
- 1 league row (legacy `leagues`) with slug=QA-DUMMY-<sport>
- 1 event in legacy `events` (status=prematch, starts_at=NOW()+7d)
- 1 event in `events_v2` with same id + league_slug=QA-DUMMY-<sport>
- 3-5 markets in `markets_v2` (T/T or 1X2, U/O, Handicap, plus 1-2 sport-specific)
- 2-3 outcomes per market in `outcomes_v2` (realistic odds)

Cleanup via cleanup-dummy-sports.py (DELETE on league_slug LIKE 'QA-DUMMY-%').

Run from VPS (or local with Supabase creds in env).
"""
import urllib.request, json, uuid, os, sys
from datetime import datetime, timedelta, timezone

KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.popen("ssh scraper-vps 'grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2'").read().strip()
URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.popen("ssh scraper-vps 'grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2'").read().strip()

assert KEY and URL, "missing supabase creds"

HEADERS = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json', 'Prefer': 'return=representation'}

def req(method, path, body=None):
    full_url = f'{URL}/rest/v1/{path}'
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(full_url, data=data, headers=HEADERS, method=method)
    try:
        return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f'  HTTP {e.code} on {method} {path}: {body_text[:200]}', file=sys.stderr)
        return None

# Sport configs: legacy slug → market spec
# Each market: (market_type, market_name_for_v2, outcomes [(name, odds, line)])
# IMPORTANT: events_v2.sport_slug MUST be the KIOSK-style slug (e.g. "handball" not "pallamano"),
# else v_player_events JOIN returns sport_slug=NULL → page-v2 falls through to legacy UI.
# v2_slug column below = events_v2.sport_slug. Legacy slug (key) = legacy events.sport.slug,
# stored in `sports` table and used by `sport_id` FK.
SPORTS = {
    'baseball':            {'sport_id': '16667314-d8d0-4a3e-aa9f-a155f6df13de', 'v2_slug': 'baseball',          'v2_name': 'Baseball',          'home': 'Boston Red Sox QA', 'away': 'NY Yankees QA'},
    'esports':             {'sport_id': 'a007fae5-91f5-4c95-a7fe-3a0fa39783d3', 'v2_slug': 'esports',           'v2_name': 'Esports',           'home': 'Team Alpha QA',    'away': 'Team Bravo QA'},
    'pallamano':           {'sport_id': '161815ec-30ab-4333-9780-d4176303d588', 'v2_slug': 'handball',          'v2_name': 'Handball',          'home': 'Hand A QA',         'away': 'Hand B QA'},
    'hockey-ghiaccio':     {'sport_id': 'af3a27e5-71fe-46eb-a855-4e94d556156e', 'v2_slug': 'ice-hockey',        'v2_name': 'Ice Hockey',        'home': 'Ice Bears QA',      'away': 'Ice Wolves QA'},
    'volley':              {'sport_id': '786f967b-342f-442c-9442-5e28d5023c1d', 'v2_slug': 'volleyball',        'v2_name': 'Volleyball',        'home': 'Spike Aces QA',     'away': 'Net Kings QA'},
    'freccette':           {'sport_id': 'f1277c9f-230e-4441-88c7-be09002e4c57', 'v2_slug': 'darts',             'v2_name': 'Darts',             'home': 'Player Smith QA',   'away': 'Player Jones QA'},
    'rugby':               {'sport_id': 'c92e1921-32c2-45f4-a3a1-f63b5cf6cac3', 'v2_slug': 'rugby',             'v2_name': 'Rugby',             'home': 'Lions QA',          'away': 'Sharks QA'},
    'cricket':             {'sport_id': '28da75b0-8835-4892-acfd-a56f824f79f7', 'v2_slug': 'cricket',           'v2_name': 'Cricket',           'home': 'Mumbai QA',         'away': 'Chennai QA'},
    'boxe':                {'sport_id': 'ec0303c9-79b1-4da5-81b1-78137767e5ec', 'v2_slug': 'boxing',            'v2_name': 'Boxing',            'home': 'Fighter Red QA',    'away': 'Fighter Blue QA'},
    'arti-marziali':       {'sport_id': '4554dd2c-8507-4093-b1e0-d76fe0bcff7d', 'v2_slug': 'mma',               'v2_name': 'MMA',               'home': 'MMA Red QA',        'away': 'MMA Blue QA'},
    'football-americano':  {'sport_id': '63265903-76c3-4d3b-acf6-efcdf6699ad4', 'v2_slug': 'american-football', 'v2_name': 'American Football', 'home': 'Patriots QA',       'away': 'Cowboys QA'},
    'snooker':             {'sport_id': 'cd11415b-f96a-4aef-bb6e-1e6858c149e3', 'v2_slug': 'snooker',           'v2_name': 'Snooker',           'home': "O'Sullivan QA",     'away': 'Trump QA'},
}

# Markets per sport (market_name in markets_v2 = source name; will be translated by view)
# Each: list of (market_name, [(outcome_key, line, odds)])
def markets_for(sport):
    """Return list of (market_name, [(outcome_key, line, odds), ...])"""
    is_3way = sport in ('pallamano', 'hockey-ghiaccio')  # 3-way ML in legacy translation
    base = []
    if is_3way:
        base.append(('3-Way Result', [('home', None, 1.85), ('draw', None, 3.40), ('away', None, 4.20)]))
    base.append(('ML', [('home', None, 1.65), ('away', None, 2.20)]))
    base.append(('Spread', [('home', -2.5, 1.90), ('away', 2.5, 1.90)]))
    base.append(('Totals', [('over', 145.5, 1.85), ('under', 145.5, 1.85)]))
    sport_extra = {
        'baseball':            [('Total Bases O/U', [('over', 8.5, 1.85), ('under', 8.5, 1.85)])],
        'pallamano':           [('Spread - 1T', [('home', -1.5, 1.92), ('away', 1.5, 1.88)]),
                                ('Both Teams To Score', [('yes', None, 1.30), ('no', None, 3.20)])],
        'hockey-ghiaccio':     [('Totals - 1T', [('over', 1.5, 1.95), ('under', 1.5, 1.85)])],
        'volley':              [('T/T 1° Set', [('home', None, 1.70), ('away', None, 2.10)])],
        'freccette':           [('Total Legs', [('over', 4.5, 1.90), ('under', 4.5, 1.90)])],
        'rugby':               [('Total Tries 2-Way', [('over', 5.5, 1.85), ('under', 5.5, 1.85)])],
        'cricket':             [('Player of the Match', [('home_player', None, 2.50), ('away_player', None, 2.50)]),
                                ('To Win the Toss', [('home', None, 1.95), ('away', None, 1.95)])],
        'boxe':                [('Method of Victory', [('ko_home', None, 2.50), ('ko_away', None, 3.20), ('decision', None, 2.10)]),
                                ('Will the Fight Go the Distance', [('yes', None, 1.85), ('no', None, 1.85)])],
        'arti-marziali':       [('Method of Victory', [('ko_home', None, 2.40), ('sub_home', None, 4.50), ('decision', None, 2.50)]),
                                ('Total Rounds', [('over', 1.5, 1.75), ('under', 1.5, 2.00)])],
        'football-americano':  [('ML 1Q', [('home', None, 1.95), ('away', None, 1.95)]),
                                ('Spread 1Q', [('home', -3.5, 1.88), ('away', 3.5, 1.88)])],
        'snooker':             [('Total Frames', [('over', 6.5, 1.85), ('under', 6.5, 1.85)]),
                                ('Highest Break', [('home', None, 1.80), ('away', None, 2.00)])],
    }
    return base + sport_extra.get(sport, [])

# Time
now = datetime.now(timezone.utc)
starts_at = (now + timedelta(days=7)).isoformat()

print(f'Seeding dummy events at starts_at={starts_at}')
print(f'Cleanup pattern: league_slug LIKE QA-DUMMY-%\n')

results = []
for slug, info in SPORTS.items():
    print(f'=== {slug} ===')
    league_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())
    league_slug = f'QA-DUMMY-{slug}'

    # 1. league (constraint: country or tour_code required) — upsert pattern
    r = req('POST', 'leagues', {
        'id': league_id,
        'sport_id': info['sport_id'],
        'name': f'QA Dummy {slug.title()} League',
        'slug': league_slug,
        'is_active': True,
        'tour_code': 'qa-dummy',
    })
    if r is None:
        # Lookup existing by slug + sport_id
        url = f'leagues?select=id&sport_id=eq.{info["sport_id"]}&slug=eq.{league_slug}'
        existing = req('GET', url)
        if existing and len(existing) > 0:
            league_id = existing[0]['id']
            print(f'  league {league_id[:8]} (reused existing)')
        else:
            print(f'  ❌ league lookup failed'); continue
    else:
        print(f'  league {league_id[:8]}')

    # 2. legacy events (source is generated column — don't pass)
    r = req('POST', 'events', {
        'id': event_id,
        'sport_id': info['sport_id'],
        'league_id': league_id,
        'home_team': info['home'],
        'away_team': info['away'],
        'starts_at': starts_at,
        'status': 'prematch',
        'is_live': False,
        'external_id': f'qa-dummy-{slug}-{event_id[:8]}',
    })
    if r is None: print('  ❌ legacy event failed'); continue
    print(f'  legacy event {event_id[:8]}')

    # 3. events_v2 — sport_slug MUST be kiosk-style for v_player_events JOIN to populate
    r = req('POST', 'events_v2', {
        'id': event_id,
        'odds_api_id': 999000000 + abs(hash(slug)) % 1000000,
        'home': info['home'],
        'away': info['away'],
        'starts_at': starts_at,
        'sport_slug': info['v2_slug'],
        'sport_name': info['v2_name'],
        'league_slug': league_slug,
        'league_name': f'QA Dummy {slug.title()} League',
        'status': 'pending',
    })
    if r is None: print('  ❌ events_v2 failed'); continue
    print(f'  events_v2 {event_id[:8]}')

    # 4. markets_v2 + outcomes_v2
    for mname, outs in markets_for(slug):
        market_id = str(uuid.uuid4())
        r = req('POST', 'markets_v2', {
            'id': market_id,
            'event_id': event_id,
            'bookmaker': 'Bet365',
            'market_name': mname,
        })
        if r is None: print(f'  ❌ market {mname}'); continue
        for okey, line, odds in outs:
            req('POST', 'outcomes_v2', {
                'id': str(uuid.uuid4()),
                'market_id': market_id,
                'outcome_key': okey,
                'line': line,
                'odds': odds,
                'is_active': True,
            })
        print(f'  market_v2 "{mname}" + {len(outs)} outcomes')

    results.append((slug, event_id))
    print(f'  ✅ done')
    print()

print('\n=== SMOKE URLs ===')
for slug, eid in results:
    print(f'  {slug:25s} https://play.betssolution.com/event/{eid}')
