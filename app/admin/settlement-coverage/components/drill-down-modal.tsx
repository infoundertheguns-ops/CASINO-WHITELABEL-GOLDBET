"use client";

import { useEffect, useState } from "react";

// Plan D D.1 — Drill-down modal showing recent bets + recent events for a market_type.

type RecentBet = {
  bet_selection_id: string;
  result: string | null;
  settled_at: string | null;
  stake: number | string;
  bet_status: string;
  placed_at: string;
  market_type: string;
  line: number | null;
  outcome_name: string;
  outcome_odds: number | string;
};

type RecentEvent = {
  event_id: string;
  external_id: string;
  sport: string;
  flashscore_id: string | null;
  has_flashscore_id: boolean;
  has_score: boolean;
  score_home: number | null;
  score_away: number | null;
  starts_at: string;
  status: string;
};

type Props = {
  marketType: string | null;
  onClose: () => void;
};

export function DrillDownModal({ marketType, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bets, setBets] = useState<RecentBet[]>([]);
  const [events, setEvents] = useState<RecentEvent[]>([]);

  useEffect(() => {
    if (!marketType) return;
    setLoading(true);
    setError(null);
    fetch(
      `/api/admin/settlement-coverage/drill-down?market_type=${encodeURIComponent(
        marketType
      )}&limit=20`
    )
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(j.error);
        } else {
          setBets(j.recent_bets ?? []);
          setEvents(j.recent_events ?? []);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [marketType]);

  if (!marketType) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg max-w-4xl w-full max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Drill-down: <code className="font-mono">{marketType}</code>
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loading && (
          <div className="p-6 text-center text-muted-foreground">Loading…</div>
        )}
        {error && <div className="p-6 text-red-600">Error: {error}</div>}

        {!loading && !error && (
          <div className="p-4 space-y-6">
            <section>
              <h3 className="font-medium text-sm mb-2">
                Last {bets.length} bets
              </h3>
              <div className="overflow-x-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Placed</th>
                      <th className="px-2 py-1.5 text-left">Outcome</th>
                      <th className="px-2 py-1.5 text-right">Odds</th>
                      <th className="px-2 py-1.5 text-right">Stake</th>
                      <th className="px-2 py-1.5 text-left">Result</th>
                      <th className="px-2 py-1.5 text-left">Settled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bets.map((b) => (
                      <tr key={b.bet_selection_id} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {b.placed_at
                            ? new Date(b.placed_at).toISOString().slice(0, 16).replace("T", " ")
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5">{b.outcome_name}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {Number(b.outcome_odds).toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          €{Number(b.stake).toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5">
                          {b.result === "won" && (
                            <span className="text-green-700">won</span>
                          )}
                          {b.result === "lost" && (
                            <span className="text-red-700">lost</span>
                          )}
                          {b.result === "void" && (
                            <span className="text-gray-500">void</span>
                          )}
                          {!b.result && (
                            <span className="text-amber-700">pending</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {b.settled_at
                            ? new Date(b.settled_at).toISOString().slice(0, 16).replace("T", " ")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                    {bets.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-2 py-3 text-center text-muted-foreground"
                        >
                          No recent bets on this market.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="font-medium text-sm mb-2">
                Last {events.length} events with this market
              </h3>
              <div className="overflow-x-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Starts</th>
                      <th className="px-2 py-1.5 text-left">Sport</th>
                      <th className="px-2 py-1.5 text-left">Status</th>
                      <th className="px-2 py-1.5 text-center">FS</th>
                      <th className="px-2 py-1.5 text-center">Score</th>
                      <th className="px-2 py-1.5 text-left">External ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.event_id} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {e.starts_at
                            ? new Date(e.starts_at).toISOString().slice(0, 16).replace("T", " ")
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5">{e.sport}</td>
                        <td className="px-2 py-1.5">{e.status}</td>
                        <td className="px-2 py-1.5 text-center">
                          {e.has_flashscore_id ? "✓" : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {e.has_score ? `${e.score_home}-${e.score_away}` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono">
                          {e.external_id}
                        </td>
                      </tr>
                    ))}
                    {events.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-2 py-3 text-center text-muted-foreground"
                        >
                          No recent events with this market.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
