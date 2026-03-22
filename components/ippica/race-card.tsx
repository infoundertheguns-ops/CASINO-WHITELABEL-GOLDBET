"use client";

import Link from "next/link";
import { RaceHeader } from "./race-header";
import { RunnerRow } from "./runner-row";
import type { IppicaRace, IppicaRunner, IppicaMarketWithOdds, IppicaBetSelection } from "@/lib/types/ippica";

interface Props {
  race: IppicaRace;
  runners: IppicaRunner[];
  markets: IppicaMarketWithOdds[];
  onToggleBet: (sel: IppicaBetSelection) => void;
  isSelected: (oddsId: string) => boolean;
}

export function RaceCard({ race, runners, markets, onToggleBet, isSelected }: Props) {
  const winnerMarket = markets.find(m => m.market_type === "Winner");
  const placeMarket = markets.find(m => m.market_type.startsWith("Place"));

  const isFinished = race.status === "finished" || race.status === "abandoned";

  // Build odds lookup: runner_number → odds
  const winnerOddsMap = new Map<number, any>();
  const placeOddsMap = new Map<number, any>();

  if (winnerMarket) {
    for (const o of winnerMarket.odds) {
      if (o.runner_number != null) winnerOddsMap.set(o.runner_number, o);
    }
  }
  if (placeMarket) {
    for (const o of placeMarket.odds) {
      if (o.runner_number != null) placeOddsMap.set(o.runner_number, o);
    }
  }

  const activeRunners = runners.filter(r => !r.is_non_runner);
  const nonRunners = runners.filter(r => r.is_non_runner);

  function makeBetSelection(runner: IppicaRunner, market: IppicaMarketWithOdds | undefined, oddsEntry: any): IppicaBetSelection | null {
    if (!market || !oddsEntry || !oddsEntry.odds) return null;
    return {
      source: "ippica",
      raceId: race.id,
      raceName: race.title,
      meetingName: race.meeting_name || "",
      raceNumber: race.race_number,
      marketType: market.market_type,
      marketId: market.id,
      selectionName: runner.name,
      odds: oddsEntry.odds,
      oddsId: oddsEntry.id,
      runnerNumber: runner.runner_number,
    };
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 border-b border-gray-100">
        <RaceHeader race={race} compact />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] font-semibold uppercase text-gray-400 border-b border-gray-100">
              <th className="px-2 py-2 w-8">#</th>
              <th className="px-2 py-2">Cavallo</th>
              <th className="px-2 py-2 hidden sm:table-cell">Form</th>
              <th className="px-2 py-2 text-center w-20">Vinc.</th>
              <th className="px-2 py-2 text-center w-20">Piaz.</th>
            </tr>
          </thead>
          <tbody>
            {activeRunners.map(runner => {
              const wOdds = winnerOddsMap.get(runner.runner_number);
              const pOdds = placeOddsMap.get(runner.runner_number);
              const wSel = makeBetSelection(runner, winnerMarket, wOdds);
              const pSel = makeBetSelection(runner, placeMarket, pOdds);

              return (
                <RunnerRow
                  key={runner.id}
                  runner={runner}
                  winnerOdds={wOdds}
                  placeOdds={pOdds}
                  onClickWinner={wSel ? () => onToggleBet(wSel) : undefined}
                  onClickPlace={pSel ? () => onToggleBet(pSel) : undefined}
                  isWinnerSelected={wOdds ? isSelected(wOdds.id) : false}
                  isPlaceSelected={pOdds ? isSelected(pOdds.id) : false}
                  isFinished={isFinished}
                />
              );
            })}
            {nonRunners.map(runner => (
              <RunnerRow key={runner.id} runner={runner} isFinished={isFinished} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-gray-100 flex justify-end">
        <Link
          href={`/ippica/${race.id}`}
          className="text-xs font-semibold text-brand hover:underline"
        >
          Tutti i mercati →
        </Link>
      </div>
    </div>
  );
}
