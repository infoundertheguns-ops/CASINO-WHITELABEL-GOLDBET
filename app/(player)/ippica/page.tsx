"use client";

import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useIppica, useNextRaces, useRaceOdds } from "@/lib/hooks/use-ippica";
import { useAuth } from "@/lib/hooks/use-auth";
import { MeetingSidebar } from "@/components/ippica/meeting-sidebar";
import { NextRacesStrip } from "@/components/ippica/next-races-strip";
import { RaceCard } from "@/components/ippica/race-card";
import { BetslipPanel } from "@/components/sportsbook/betslip-panel";
import type { IppicaBetSelection } from "@/lib/types/ippica";
import type { IppicaRunner } from "@/lib/types/ippica";
import type { BetslipItem } from "@/lib/hooks/use-sportsbook";
import { createClient } from "@/lib/supabase/client";

export default function IppicaPage() {
  const {
    meetingsByCountry, races, selectedMeeting,
    selectedMeetingId, setSelectedMeetingId, loading,
  } = useIppica();
  const { races: nextRaces } = useNextRaces(8);
  const { user, wallet, refreshWallet } = useAuth();

  // Betslip state
  const [ippicaBetslip, setIppicaBetslip] = useState<IppicaBetSelection[]>([]);
  const [stake, setStake] = useState("");
  const [placingBet, setPlacingBet] = useState(false);
  const [betResult, setBetResult] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Fetch odds for all races in current meeting
  const raceIds = useMemo(() => races.map(r => r.id), [races]);
  const { oddsMap } = useRaceOdds(raceIds);

  // Fetch runners for selected meeting's races
  const [runnersMap, setRunnersMap] = useState<Map<string, IppicaRunner[]>>(new Map());

  useEffect(() => {
    if (raceIds.length === 0) { setRunnersMap(new Map()); return; }

    async function fetchRunners() {
      const supabase = createClient();
      const { data } = await supabase
        .from("ippica_runners")
        .select("*")
        .in("race_id", raceIds)
        .order("runner_number");

      const map = new Map<string, IppicaRunner[]>();
      for (const r of (data || [])) {
        const list = map.get(r.race_id) || [];
        list.push(r as IppicaRunner);
        map.set(r.race_id, list);
      }
      setRunnersMap(map);
    }
    fetchRunners();
  }, [raceIds.join(",")]);

  const selectedOddsIds = new Set(ippicaBetslip.map(s => s.oddsId));

  function toggleBet(sel: IppicaBetSelection) {
    setIppicaBetslip(prev => {
      const exists = prev.find(s => s.oddsId === sel.oddsId);
      if (exists) return prev.filter(s => s.oddsId !== sel.oddsId);
      return [...prev, sel];
    });
  }

  // Convert ippica selections to BetslipItem format for display
  const betslipItems: BetslipItem[] = ippicaBetslip.map(s => ({
    eventId: s.raceId,
    marketName: s.marketType === "Winner" ? "Vincente" : s.marketType.replace("Place", "Piazzato"),
    selection: s.selectionName,
    odds: s.odds,
    match: `${s.meetingName} - R${s.raceNumber}`,
    marketId: s.marketId,
    outcomeId: s.oddsId,
  }));

  const totalOdds = ippicaBetslip.reduce((acc, s) => acc * s.odds, 1);

  async function placeBet() {
    if (ippicaBetslip.length === 0 || !stake) return;
    setPlacingBet(true);
    setBetResult(null);
    try {
      const res = await fetch("/api/player/place-bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stake: parseFloat(stake),
          source: "ippica",
          selections: ippicaBetslip.map(s => ({
            source: "ippica",
            raceId: s.raceId,
            marketId: s.marketId,
            oddsId: s.oddsId,
            odds: s.odds,
            selectionName: s.selectionName,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBetResult({ type: "success", text: "Scommessa piazzata!" });
        setIppicaBetslip([]);
        setStake("");
        refreshWallet?.();
      } else {
        setBetResult({ type: "error", text: data.error || "Errore" });
      }
    } catch (e: any) {
      setBetResult({ type: "error", text: e.message });
    } finally {
      setPlacingBet(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Next races strip */}
      <NextRacesStrip races={nextRaces} onSelectMeeting={setSelectedMeetingId} />

      {/* Mobile: meeting selector button */}
      <div className="lg:hidden">
        <button
          onClick={() => setShowMobileSidebar(!showMobileSidebar)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-200 text-sm font-semibold text-gray-800"
        >
          <span>🏇 {selectedMeeting?.name || "Seleziona ippodromo"}</span>
          <span className="text-gray-400">{showMobileSidebar ? "▲" : "▼"}</span>
        </button>
        {showMobileSidebar && (
          <div className="mt-2 bg-white rounded-xl border border-gray-200 p-2 max-h-[60vh] overflow-y-auto">
            <MeetingSidebar
              meetingsByCountry={meetingsByCountry}
              selectedMeetingId={selectedMeetingId}
              onSelect={(id) => { setSelectedMeetingId(id); setShowMobileSidebar(false); }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <div className="hidden lg:block w-56 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 p-3 sticky top-[76px] max-h-[calc(100vh-100px)] overflow-y-auto">
            <p className="text-xs font-semibold text-gray-400 uppercase px-3 mb-2">Ippodromi</p>
            <MeetingSidebar
              meetingsByCountry={meetingsByCountry}
              selectedMeetingId={selectedMeetingId}
              onSelect={setSelectedMeetingId}
            />
          </div>
        </div>

        {/* Main content: race cards */}
        <div className="flex-1 min-w-0 space-y-4">
          {selectedMeeting && (
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-800">{selectedMeeting.name}</h1>
              <span className="text-xs text-gray-400">
                {selectedMeeting.race_type === "TR" ? "Trotto" : "Galoppo"} · {selectedMeeting.country}
              </span>
            </div>
          )}

          {races.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              Nessuna corsa disponibile
            </div>
          ) : (
            races.map(race => (
              <RaceCard
                key={race.id}
                race={race}
                runners={runnersMap.get(race.id) || []}
                markets={oddsMap.get(race.id) || []}
                onToggleBet={toggleBet}
                isSelected={(oddsId) => selectedOddsIds.has(oddsId)}
              />
            ))
          )}
        </div>

        {/* Desktop betslip */}
        <div className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-[76px]">
            <BetslipPanel
              betslip={betslipItems}
              allEvents={[]}
              totalOdds={totalOdds}
              placingBet={placingBet}
              stake={stake}
              setStake={setStake}
              onPlaceBet={placeBet}
              onRemoveItem={(item) => {
                setIppicaBetslip(prev => prev.filter(s => s.oddsId !== item.outcomeId));
              }}
              onClear={() => setIppicaBetslip([])}
              betMode="auto"
              setBetMode={() => {}}
              systemComboSize={2}
              setSystemComboSize={() => {}}
              user={user}
              wallet={wallet}
              msg={betResult}
            />
          </div>
        </div>
      </div>

      {/* Mobile betslip floating button */}
      {ippicaBetslip.length > 0 && (
        <div className="lg:hidden fixed bottom-[70px] left-1/2 -translate-x-1/2 z-40 max-w-[430px] w-full px-4">
          <button
            onClick={() => setShowMobileBetslip(!showMobileBetslip)}
            className="w-full bg-brand text-white rounded-xl py-3 px-4 font-semibold text-sm flex items-center justify-between shadow-lg"
          >
            <span>Biglietto ({ippicaBetslip.length})</span>
            <span className="font-mono">{totalOdds.toFixed(2)}</span>
          </button>
          {showMobileBetslip && (
            <div className="mt-2 bg-white rounded-xl border border-gray-200 shadow-xl p-4 max-h-[50vh] overflow-y-auto">
              <BetslipPanel
                betslip={betslipItems}
                allEvents={[]}
                totalOdds={totalOdds}
                placingBet={placingBet}
                stake={stake}
                setStake={setStake}
                onPlaceBet={placeBet}
                onRemoveItem={(item) => {
                  setIppicaBetslip(prev => prev.filter(s => s.oddsId !== item.outcomeId));
                }}
                onClear={() => setIppicaBetslip([])}
                betMode="auto"
                setBetMode={() => {}}
                systemComboSize={2}
                setSystemComboSize={() => {}}
                user={user}
                wallet={wallet}
                msg={betResult}
                compact
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
