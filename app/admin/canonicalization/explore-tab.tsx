// app/admin/canonicalization/explore-tab.tsx
// Hierarchical browse: Sport → Country → League → Event-group → expanded SourceCards.
// Top search bar bypasses the tree and renders a flat list of matching groups.
"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BrowseSport,
  BrowseLeague,
  EventGroup as TGroup,
} from '@/lib/admin/canonicalization-types';
import { EventGroup as EventGroupRow } from './components/event-group';

// ─── small inline UI helpers ─────────────────────────────────────────
function Spinner({ label }: { label?: string }) {
  return <span className="text-xs opacity-70">{label ?? 'Caricamento…'}</span>;
}
function GroupTypeBadge({ type }: { type: TGroup['group_type'] }) {
  const map = {
    flashscore: '🟢',
    cross_source: '🟣',
    trigram: '🟡',
    isolated: '🔵',
  } as const;
  return <span title={`group_type=${type}`}>{map[type]}</span>;
}

// Country grouping helper.
// IMPORTANT: country strings come from heterogeneous sources with mixed
// Italian/English labels and inconsistent country_code values. We normalize
// via an explicit ISO/alias → canonical-Italian-label map; if a country
// isn't in the map, fall back to lower-case country string + Title Case
// display. This collapses Italy↔Italia into one bucket.
interface CountryBucket {
  country: string;
  leagues: BrowseLeague[];
  totalEvents: number;
}

// Lower-cased keys → canonical Italian display label.
// Covers ISO-2 + common Italian/English/native variants for the top 30 markets.
const COUNTRY_NORMALIZE: Record<string, string> = {
  'it': 'Italia', 'italia': 'Italia', 'italy': 'Italia',
  'fr': 'Francia', 'francia': 'Francia', 'france': 'Francia',
  'es': 'Spagna', 'spagna': 'Spagna', 'spain': 'Spagna', 'españa': 'Spagna',
  'de': 'Germania', 'germania': 'Germania', 'germany': 'Germania', 'deutschland': 'Germania',
  'gb': 'Inghilterra', 'uk': 'Inghilterra', 'inghilterra': 'Inghilterra', 'england': 'Inghilterra', 'great britain': 'Inghilterra',
  'pt': 'Portogallo', 'portogallo': 'Portogallo', 'portugal': 'Portogallo',
  'nl': 'Olanda', 'olanda': 'Olanda', 'netherlands': 'Olanda', 'holland': 'Olanda',
  'be': 'Belgio', 'belgio': 'Belgio', 'belgium': 'Belgio',
  'ch': 'Svizzera', 'svizzera': 'Svizzera', 'switzerland': 'Svizzera',
  'at': 'Austria', 'austria': 'Austria',
  'gr': 'Grecia', 'grecia': 'Grecia', 'greece': 'Grecia',
  'tr': 'Turchia', 'turchia': 'Turchia', 'turkey': 'Turchia',
  'ru': 'Russia', 'russia': 'Russia',
  'ua': 'Ucraina', 'ucraina': 'Ucraina', 'ukraine': 'Ucraina',
  'pl': 'Polonia', 'polonia': 'Polonia', 'poland': 'Polonia',
  'cz': 'Repubblica Ceca', 'repubblica ceca': 'Repubblica Ceca', 'czech republic': 'Repubblica Ceca', 'czech': 'Repubblica Ceca',
  'sk': 'Slovacchia', 'slovacchia': 'Slovacchia', 'slovakia': 'Slovacchia',
  'hu': 'Ungheria', 'ungheria': 'Ungheria', 'hungary': 'Ungheria',
  'ro': 'Romania', 'romania': 'Romania',
  'rs': 'Serbia', 'serbia': 'Serbia',
  'hr': 'Croazia', 'croazia': 'Croazia', 'croatia': 'Croazia',
  'dk': 'Danimarca', 'danimarca': 'Danimarca', 'denmark': 'Danimarca',
  'no': 'Norvegia', 'norvegia': 'Norvegia', 'norway': 'Norvegia',
  'se': 'Svezia', 'svezia': 'Svezia', 'sweden': 'Svezia',
  'fi': 'Finlandia', 'finlandia': 'Finlandia', 'finland': 'Finlandia',
  'br': 'Brasile', 'brasile': 'Brasile', 'brazil': 'Brasile', 'brasil': 'Brasile',
  'ar': 'Argentina', 'argentina': 'Argentina',
  'us': 'USA', 'usa': 'USA', 'united states': 'USA',
  'mx': 'Messico', 'messico': 'Messico', 'mexico': 'Messico',
  'jp': 'Giappone', 'giappone': 'Giappone', 'japan': 'Giappone',
  'cn': 'Cina', 'cina': 'Cina', 'china': 'Cina',
};

function normalizeCountry(country: string | null, country_code: string | null): string {
  // Try ISO code first.
  if (country_code) {
    const k = country_code.toLowerCase().trim();
    if (COUNTRY_NORMALIZE[k]) return COUNTRY_NORMALIZE[k];
  }
  // Fall back to country string.
  if (country) {
    const k = country.toLowerCase().trim();
    if (COUNTRY_NORMALIZE[k]) return COUNTRY_NORMALIZE[k];
    // Unknown country → keep original capitalization but trimmed.
    return country.trim();
  }
  return 'Altro';
}

function buildCountryGroups(leagues: BrowseLeague[]): CountryBucket[] {
  const map = new Map<string, BrowseLeague[]>();
  for (const lg of leagues) {
    const country = normalizeCountry(lg.country, lg.country_code);
    const list = map.get(country);
    if (list) list.push(lg);
    else map.set(country, [lg]);
  }
  const groups: CountryBucket[] = [];
  for (const [country, countryLeagues] of map) {
    const totalEvents = countryLeagues.reduce((s, l) => s + l.event_count, 0);
    countryLeagues.sort((a, b) => {
      if (b.event_count !== a.event_count) return b.event_count - a.event_count;
      return a.league_name.localeCompare(b.league_name, undefined, { sensitivity: 'base' });
    });
    groups.push({ country, leagues: countryLeagues, totalEvents });
  }
  groups.sort((a, b) => a.country.localeCompare(b.country, undefined, { sensitivity: 'base' }));
  return groups;
}

function GroupRow({
  group,
  expanded,
  onToggle,
}: {
  group: TGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sourceOnly = group.events.length > 0
    && group.events.every(e => e.is_source_only === true);
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-2 py-1 text-xs flex items-center gap-2 hover:bg-black/5"
        style={{ background: expanded ? 'var(--admin-hover)' : 'transparent' }}
      >
        <span className="opacity-60 w-3">{expanded ? '▾' : '▸'}</span>
        <GroupTypeBadge type={group.group_type} />
        {sourceOnly && (
          <span title="Tutti gli eventi sono is_source_only=true: lega strutturalmente non in Flashscore.">🔒</span>
        )}
        <span>{group.real_world_label}</span>
        <span className="ml-auto opacity-60">{group.events.length} src</span>
      </button>
      {expanded && (
        <div className="pl-6 pr-2 py-2">
          <EventGroupRow group={group} />
        </div>
      )}
    </div>
  );
}

export function ExploreTab() {
  const [sports, setSports] = useState<BrowseSport[] | null>(null);
  const [sportsErr, setSportsErr] = useState<string | null>(null);

  const [openSport, setOpenSport] = useState<string | null>(null);
  const [leaguesBySport, setLeaguesBySport] = useState<Record<string, BrowseLeague[] | 'loading' | { error: string }>>({});

  // Country expansion state — keyed by `${sportId}::${country}`.
  const [openCountries, setOpenCountries] = useState<Set<string>>(new Set());

  const [openLeague, setOpenLeague] = useState<string | null>(null);
  const [groupsByLeague, setGroupsByLeague] = useState<Record<string, TGroup[] | 'loading' | { error: string }>>({});

  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  // ─── search state (subsumes Inspector) ─────────────────────────────
  const [searchQ, setSearchQ] = useState('');
  const [searchGroups, setSearchGroups] = useState<TGroup[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  // ─── 1. mount: load sports ─────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const r = await fetch('/api/admin/canonicalization/browse-sports', { signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!ac.signal.aborted) setSports(json.sports ?? []);
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        if (!ac.signal.aborted) setSportsErr(e instanceof Error ? e.message : 'Errore');
      }
    })();
    return () => ac.abort();
  }, []);

  // ─── 2. fetch leagues when a sport is opened (cached per-sport) ────
  useEffect(() => {
    if (!openSport) return;
    if (leaguesBySport[openSport]) return; // cached or loading or errored
    setLeaguesBySport(prev => ({ ...prev, [openSport]: 'loading' }));
    const ac = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/admin/canonicalization/browse-leagues?sport_id=${encodeURIComponent(openSport)}`, { signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (ac.signal.aborted) return;
        setLeaguesBySport(prev => ({ ...prev, [openSport]: json.leagues ?? [] }));
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setLeaguesBySport(prev => ({ ...prev, [openSport]: { error: e instanceof Error ? e.message : 'Errore' } }));
      }
    })();
    return () => ac.abort();
  }, [openSport]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 3. fetch groups when a league is opened (cached per-league) ───
  const groupCacheKey = (sportId: string, leagueId: string) => `${sportId}::${leagueId}`;
  useEffect(() => {
    if (!openSport || !openLeague) return;
    const k = groupCacheKey(openSport, openLeague);
    if (groupsByLeague[k]) return;
    setGroupsByLeague(prev => ({ ...prev, [k]: 'loading' }));
    const ac = new AbortController();
    (async () => {
      try {
        const url = `/api/admin/canonicalization/browse-groups?sport_id=${encodeURIComponent(openSport)}&league_id=${encodeURIComponent(openLeague)}&limit=100`;
        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (ac.signal.aborted) return;
        setGroupsByLeague(prev => ({ ...prev, [k]: json.groups ?? [] }));
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setGroupsByLeague(prev => ({ ...prev, [k]: { error: e instanceof Error ? e.message : 'Errore' } }));
      }
    })();
    return () => ac.abort();
  }, [openSport, openLeague]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 4. search bar (debounced 400ms, AbortController-cancellable) ──
  // When non-empty (≥2 chars), tree collapses and we render a flat list.
  // Search hits ALL sports — we need ANY sport_id; the RPC requires it,
  // so we pick the largest sport (Calcio typically) as the scope. This
  // matches operator expectations since cross-sport searches are rare.
  // For broader search, the operator can also use the legacy Inspector
  // RPC (still mounted at /api/admin/canonicalization/inspect).
  const searchAcRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const trimmed = searchQ.trim();
    if (trimmed.length < 2) {
      setSearchGroups(null);
      setSearchLoading(false);
      setSearchErr(null);
      return;
    }
    if (!sports || sports.length === 0) return;

    searchAcRef.current?.abort();
    const ac = new AbortController();
    searchAcRef.current = ac;
    const t = setTimeout(async () => {
      setSearchLoading(true);
      setSearchErr(null);
      try {
        // Run search per sport in parallel and merge — keeps tree-search
        // semantics ("anywhere on the platform") without needing a global RPC.
        const results = await Promise.all(
          sports.map(s =>
            fetch(`/api/admin/canonicalization/browse-groups?sport_id=${encodeURIComponent(s.sport_id)}&q=${encodeURIComponent(trimmed)}&limit=50`, { signal: ac.signal })
              .then(r => r.ok ? r.json() : { groups: [] })
              .catch(() => ({ groups: [] }))
          )
        );
        if (ac.signal.aborted) return;
        const merged: TGroup[] = results.flatMap((r: { groups?: TGroup[] }) => r.groups ?? []);
        // Sort by starts_at DESC (mirrors per-sport RPC ordering)
        merged.sort((a, b) => {
          const ta = a.events[0]?.starts_at ?? '';
          const tb = b.events[0]?.starts_at ?? '';
          return tb.localeCompare(ta);
        });
        setSearchGroups(merged.slice(0, 100));
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setSearchErr(e instanceof Error ? e.message : 'Errore');
      } finally {
        if (!ac.signal.aborted) setSearchLoading(false);
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [searchQ, sports]);

  // ─── render ────────────────────────────────────────────────────────
  const inSearchMode = searchQ.trim().length >= 2;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <input
          type="search"
          placeholder="Cerca team / external_id / flashscore_id (≥ 2 caratteri)..."
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          className="flex-1 max-w-xl px-3 py-2 border rounded text-sm"
          style={{ borderColor: 'var(--admin-border)' }}
        />
        <a
          href="/api/admin/canonicalization/export.csv"
          download
          className="px-3 py-2 border rounded text-xs hover:bg-black/5"
          style={{ borderColor: 'var(--admin-border)' }}
          title="Scarica un CSV con tutti i gruppi (una riga per cluster cross-source)"
        >
          📥 Esporta CSV (tutti i gruppi)
        </a>
      </div>

      {inSearchMode ? (
        <SearchResults
          loading={searchLoading}
          error={searchErr}
          groups={searchGroups}
          q={searchQ.trim()}
          expandedKey={expandedGroupKey}
          onToggle={k => setExpandedGroupKey(prev => (prev === k ? null : k))}
        />
      ) : (
        <Tree
          sports={sports}
          sportsErr={sportsErr}
          openSport={openSport}
          setOpenSport={setOpenSport}
          leaguesBySport={leaguesBySport}
          openCountries={openCountries}
          setOpenCountries={setOpenCountries}
          openLeague={openLeague}
          setOpenLeague={setOpenLeague}
          groupsByLeague={groupsByLeague}
          groupCacheKey={groupCacheKey}
          expandedGroupKey={expandedGroupKey}
          setExpandedGroupKey={setExpandedGroupKey}
        />
      )}
    </div>
  );
}

// ─── tree subcomponents (kept inline; no need to export) ─────────────

function SearchResults({
  loading,
  error,
  groups,
  q,
  expandedKey,
  onToggle,
}: {
  loading: boolean;
  error: string | null;
  groups: TGroup[] | null;
  q: string;
  expandedKey: string | null;
  onToggle: (k: string) => void;
}) {
  if (loading) return <div className="text-sm opacity-70">Caricamento risultati…</div>;
  if (error) return <div className="text-sm text-red-600">Errore: {error}</div>;
  if (!groups || groups.length === 0) return <div className="text-sm opacity-70">Nessun risultato per "{q}".</div>;
  return (
    <div className="text-xs opacity-70 mb-2">
      <div className="mb-2">{groups.length} risultati</div>
      <div className="border rounded" style={{ borderColor: 'var(--admin-border)' }}>
        {groups.map(g => (
          <GroupRow
            key={g.group_key}
            group={g}
            expanded={expandedKey === g.group_key}
            onToggle={() => onToggle(g.group_key)}
          />
        ))}
      </div>
    </div>
  );
}

function Tree({
  sports,
  sportsErr,
  openSport,
  setOpenSport,
  leaguesBySport,
  openCountries,
  setOpenCountries,
  openLeague,
  setOpenLeague,
  groupsByLeague,
  groupCacheKey,
  expandedGroupKey,
  setExpandedGroupKey,
}: {
  sports: BrowseSport[] | null;
  sportsErr: string | null;
  openSport: string | null;
  setOpenSport: (s: string | null) => void;
  leaguesBySport: Record<string, BrowseLeague[] | 'loading' | { error: string }>;
  openCountries: Set<string>;
  setOpenCountries: React.Dispatch<React.SetStateAction<Set<string>>>;
  openLeague: string | null;
  setOpenLeague: (l: string | null) => void;
  groupsByLeague: Record<string, TGroup[] | 'loading' | { error: string }>;
  groupCacheKey: (sportId: string, leagueId: string) => string;
  expandedGroupKey: string | null;
  setExpandedGroupKey: (k: string | null) => void;
}) {
  if (sportsErr) return <div className="text-sm text-red-600">Errore caricamento sport: {sportsErr}</div>;
  if (!sports) return <Spinner label="Caricamento sport…" />;
  if (sports.length === 0) return <div className="text-sm opacity-70">Nessuno sport con eventi attivi.</div>;

  return (
    <div className="border rounded" style={{ borderColor: 'var(--admin-border)' }}>
      {sports.map(s => {
        const isOpenSport = openSport === s.sport_id;
        const leagues = leaguesBySport[s.sport_id];
        return (
          <div key={s.sport_id} className="border-b last:border-b-0" style={{ borderColor: 'var(--admin-border)' }}>
            <button
              onClick={() => {
                if (isOpenSport) {
                  setOpenSport(null);
                  setOpenLeague(null);
                } else {
                  setOpenSport(s.sport_id);
                  setOpenLeague(null);
                }
              }}
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5 text-sm"
            >
              <span className="opacity-60 w-3">{isOpenSport ? '▾' : '▸'}</span>
              <span className="font-medium">{s.sport_name}</span>
              <span className="ml-auto text-xs opacity-70">({s.event_count})</span>
            </button>
            {isOpenSport && (
              <div className="pl-4 pb-2">
                {leagues === 'loading' && <div className="px-3 py-1"><Spinner label="Caricamento leghe…" /></div>}
                {leagues && typeof leagues === 'object' && 'error' in leagues && (
                  <div className="px-3 py-1 text-xs text-red-600">Errore: {leagues.error}</div>
                )}
                {Array.isArray(leagues) && leagues.length === 0 && (
                  <div className="px-3 py-1 text-xs opacity-70">Nessuna lega.</div>
                )}
                {Array.isArray(leagues) && (
                  <CountryLevel
                    sportId={s.sport_id}
                    leagues={leagues}
                    openCountries={openCountries}
                    setOpenCountries={setOpenCountries}
                    openLeague={openLeague}
                    setOpenLeague={setOpenLeague}
                    groupsByLeague={groupsByLeague}
                    groupCacheKey={groupCacheKey}
                    expandedGroupKey={expandedGroupKey}
                    setExpandedGroupKey={setExpandedGroupKey}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CountryLevel({
  sportId,
  leagues,
  openCountries,
  setOpenCountries,
  openLeague,
  setOpenLeague,
  groupsByLeague,
  groupCacheKey,
  expandedGroupKey,
  setExpandedGroupKey,
}: {
  sportId: string;
  leagues: BrowseLeague[];
  openCountries: Set<string>;
  setOpenCountries: React.Dispatch<React.SetStateAction<Set<string>>>;
  openLeague: string | null;
  setOpenLeague: (l: string | null) => void;
  groupsByLeague: Record<string, TGroup[] | 'loading' | { error: string }>;
  groupCacheKey: (sportId: string, leagueId: string) => string;
  expandedGroupKey: string | null;
  setExpandedGroupKey: (k: string | null) => void;
}) {
  const countryGroups = useMemo(() => buildCountryGroups(leagues), [leagues]);

  const toggleCountry = (key: string) => {
    setOpenCountries(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      {countryGroups.map(cg => {
        const countryKey = `${sportId}::${cg.country}`;
        const isOpenCountry = openCountries.has(countryKey);
        return (
          <div
            key={countryKey}
            className="border-l ml-1 pl-2"
            style={{ borderColor: 'var(--admin-border)' }}
          >
            <button
              onClick={() => toggleCountry(countryKey)}
              className="w-full text-left px-2 py-1 flex items-center gap-2 hover:bg-black/5 text-xs"
            >
              <span className="opacity-60 w-3">{isOpenCountry ? '▾' : '▸'}</span>
              <span className="font-medium">{cg.country}</span>
              <span className="opacity-60">· {cg.leagues.length} {cg.leagues.length === 1 ? 'lega' : 'leghe'}</span>
              <span className="ml-auto opacity-70">({cg.totalEvents})</span>
            </button>
            {isOpenCountry && (
              <div className="pl-4 pb-1">
                {cg.leagues.map(l => {
                  const isOpenLeague = openLeague === l.league_id;
                  const k = groupCacheKey(sportId, l.league_id);
                  const groups = groupsByLeague[k];
                  return (
                    <div
                      key={l.league_id}
                      className="border-l ml-1 pl-2"
                      style={{ borderColor: 'var(--admin-border)' }}
                    >
                      <button
                        onClick={() => {
                          if (isOpenLeague) {
                            setOpenLeague(null);
                          } else {
                            setOpenLeague(l.league_id);
                          }
                        }}
                        className="w-full text-left px-2 py-1 flex items-center gap-2 hover:bg-black/5 text-xs"
                      >
                        <span className="opacity-60 w-3">{isOpenLeague ? '▾' : '▸'}</span>
                        <span>{l.league_name}</span>
                        <span className="ml-auto opacity-70">({l.event_count})</span>
                      </button>
                      {isOpenLeague && (
                        <div className="pl-4 py-1">
                          {groups === 'loading' && <Spinner label="Caricamento gruppi…" />}
                          {groups && typeof groups === 'object' && 'error' in groups && (
                            <div className="text-xs text-red-600">Errore: {groups.error}</div>
                          )}
                          {Array.isArray(groups) && groups.length === 0 && (
                            <div className="text-xs opacity-70">Nessun gruppo.</div>
                          )}
                          {Array.isArray(groups) && groups.map(g => (
                            <GroupRow
                              key={g.group_key}
                              group={g}
                              expanded={expandedGroupKey === g.group_key}
                              onToggle={() =>
                                setExpandedGroupKey(expandedGroupKey === g.group_key ? null : g.group_key)
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
