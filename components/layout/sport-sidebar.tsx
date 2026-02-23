"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSportCounts, type TimeFilter } from "@/lib/hooks/use-sport-counts";
import { useSportFilter } from "@/lib/contexts/sport-filter-context";

const SPORT_ICONS: Record<string, string> = {
  calcio: "⚽", basket: "🏀", tennis: "🎾", hockey: "🏒",
  pallavolo: "🏐", football: "🏈", baseball: "⚾", rugby: "🏉",
  boxe: "🥊", mma: "🥊", ciclismo: "🚴", motorsport: "🏎️",
  "ping-pong": "🏓", "table-tennis": "🏓", badminton: "🏸",
  cricket: "🏏", handball: "🤾", esports: "🎮",
  "hockey-ghiaccio": "🏒", snooker: "🎱", "tennis-tavolo": "🏓",
  "musica-e-spettacolo": "🎵", "league-of-legends": "🎮", "calcio-a-5": "⚽",
};

interface FeaturedLeague {
  label: string;
  icon: string;
  sportSlug: string;
  leagueSlug: string;
}

const FEATURED_LEAGUES: FeaturedLeague[] = [
  { label: "SERIE A", icon: "⚽", sportSlug: "calcio", leagueSlug: "calcio-serie-a" },
  { label: "PREMIER LEAGUE", icon: "⚽", sportSlug: "calcio", leagueSlug: "calcio-premier-league" },
  { label: "LA LIGA", icon: "⚽", sportSlug: "calcio", leagueSlug: "calcio-la-liga" },
  { label: "CHAMPIONS LEAGUE", icon: "⚽", sportSlug: "calcio", leagueSlug: "calcio-champions-league" },
  { label: "NBA", icon: "🏀", sportSlug: "basket", leagueSlug: "basket-nba" },
];

const TIME_FILTERS: { id: TimeFilter; label: string }[] = [
  { id: "all", label: "Tutti" },
  { id: "today", label: "Oggi" },
  { id: "today_tomorrow", label: "O+D" },
  { id: "3h", label: "3 Ore" },
];

export function SportSidebarContent() {
  const router = useRouter();
  const { activeSport, setActiveSport, activeLeague, setActiveLeague } = useSportFilter();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [search, setSearch] = useState("");

  const { sports, leagues, expandedSport, loading, fetchLeagues } = useSportCounts(timeFilter);

  const filteredSports = useMemo(() => {
    if (!search.trim()) return sports;
    const q = search.toLowerCase();
    return sports.filter((s) => s.name.toLowerCase().includes(q));
  }, [sports, search]);

  const filteredLeagues = useMemo(() => {
    if (!search.trim()) return leagues;
    const q = search.toLowerCase();
    return leagues.filter((l) => l.name.toLowerCase().includes(q));
  }, [leagues, search]);

  const handleSportClick = (slug: string) => {
    if (activeSport === slug) {
      setActiveSport(null);
    } else {
      setActiveSport(slug);
    }
  };

  const handleLeagueClick = (sportSlug: string, leagueSlug: string) => {
    router.push(`/sport/league/${leagueSlug}`);
  };

  const handleFeaturedClick = (f: FeaturedLeague) => {
    router.push(`/sport/league/${f.leagueSlug}`);
  };

  return (
    <div className="select-none">
      {/* ═══ SCELTI PER TE ═══ */}
      <div className="px-3 pt-3 pb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
          Scelti per te
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {FEATURED_LEAGUES.map((f) => (
            <button
              key={f.leagueSlug}
              onClick={() => handleFeaturedClick(f)}
              className={cn(
                "px-2 py-1 rounded-md text-[10px] font-semibold transition-all border",
                activeSport === f.sportSlug && activeLeague === f.leagueSlug
                  ? "bg-brand text-white border-brand"
                  : "bg-gray-50 text-gray-600 border-gray-200 hover:border-brand/40 hover:bg-brand/5"
              )}
            >
              {f.icon} {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ SEARCH ═══ */}
      <div className="px-3 py-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Cerca sport o lega..."
          className="w-full px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30"
        />
      </div>

      {/* ═══ TIME FILTERS ═══ */}
      <div className="px-3 pb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
          Campionati
        </h3>
        <div className="flex gap-1">
          {TIME_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setTimeFilter(f.id)}
              className={cn(
                "flex-1 py-1 rounded-md text-[10px] font-bold transition-all",
                timeFilter === f.id
                  ? "bg-brand text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ SPORT LIST ═══ */}
      <div className="overflow-y-auto no-scrollbar max-h-[calc(100vh-420px)]">
        {loading ? (
          <div className="px-3 py-3 space-y-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredSports.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-gray-400">Nessuno sport trovato</p>
          </div>
        ) : (
          <div className="pb-2">
            {filteredSports.map((sport) => {
              const isActive = activeSport === sport.slug;
              const isExpanded = expandedSport === sport.slug;
              const icon = SPORT_ICONS[sport.slug] || sport.icon || "⚽";

              return (
                <div key={sport.id}>
                  {/* Sport row */}
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 cursor-pointer transition-all group",
                      isActive
                        ? "bg-brand/10 border-l-2 border-l-brand"
                        : "border-l-2 border-l-transparent hover:bg-gray-50"
                    )}
                  >
                    <button
                      onClick={() => handleSportClick(sport.slug)}
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      <span className="text-sm flex-shrink-0">{icon}</span>
                      <span className={cn(
                        "text-[11px] font-semibold uppercase tracking-wide truncate",
                        isActive ? "text-brand" : "text-gray-600 group-hover:text-gray-900"
                      )}>
                        {sport.name}
                      </span>
                    </button>
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[28px] text-center",
                      isActive ? "bg-brand text-white" : "bg-gray-200 text-gray-500"
                    )}>
                      {sport.eventCount}
                    </span>
                    <button
                      onClick={() => fetchLeagues(sport.slug)}
                      className={cn(
                        "text-gray-400 hover:text-gray-600 text-[10px] transition-transform flex-shrink-0",
                        isExpanded && "rotate-90"
                      )}
                    >
                      ▶
                    </button>
                  </div>

                  {/* Leagues (expanded) */}
                  {isExpanded && (
                    <div className="bg-gray-50/60">
                      {filteredLeagues.length === 0 ? (
                        <div className="px-6 py-2">
                          <div className="h-4 bg-gray-100 rounded animate-pulse" />
                        </div>
                      ) : (
                        filteredLeagues.map((league) => {
                          const isLeagueActive = activeLeague === league.slug;
                          return (
                            <button
                              key={league.id}
                              onClick={() => handleLeagueClick(sport.slug, league.slug)}
                              className={cn(
                                "w-full flex items-center justify-between px-4 pl-9 py-1.5 text-left transition-all",
                                isLeagueActive
                                  ? "bg-brand/10 text-brand font-semibold"
                                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                              )}
                            >
                              <span className="text-[11px] truncate">{league.name}</span>
                              <span className={cn(
                                "text-[9px] font-mono ml-2 flex-shrink-0",
                                isLeagueActive ? "text-brand" : "text-gray-400"
                              )}>
                                ({league.eventCount})
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
