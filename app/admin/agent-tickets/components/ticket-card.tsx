"use client";
import { getStatusVisual, isPayable } from "../lib/status-map";

const TONE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  info:    { bg: "#3b82f620", text: "#60a5fa", border: "#3b82f6" },
  success: { bg: "#10b98120", text: "#10b981", border: "#10b981" },
  danger:  { bg: "#ef444420", text: "#ef4444", border: "#ef4444" },
  warning: { bg: "#f59e0b20", text: "#f59e0b", border: "#f59e0b" },
  violet:  { bg: "#8b5cf620", text: "#a78bfa", border: "#8b5cf6" },
  neutral: { bg: "#6b728020", text: "#94a3b8", border: "#6b7280" },
};

interface Selection {
  odds_at_placement: number;
  events?: { home_team?: string; away_team?: string; score_home?: number; score_away?: number };
}

interface Props {
  ticket: {
    ticket_code: string;
    status: string;
    bet_type: string;
    selections_count: number;
    stake: number;
    total_odds: number;
    potential_win: number;
    win_amount?: number | null;
    claimed_at?: string | null;
  };
  selections: Selection[];
  claimedByName?: string | null;
  onPay: () => void;
  onReprint: () => void;
  onUnlockExpired: () => void;
  canUnlock: boolean;
}

function CellKpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="font-mono font-extrabold text-lg" style={{ color: highlight ? "#10b981" : "var(--admin-text)" }}>{value}</div>
    </div>
  );
}

export function TicketCard({ ticket, selections, claimedByName, onPay, onReprint, onUnlockExpired, canUnlock }: Props) {
  const v = getStatusVisual(ticket.status);
  const color = TONE_COLORS[v.tone];
  const payable = isPayable(ticket.status);
  const amount = ticket.status === "won"
    ? (ticket.win_amount ?? ticket.potential_win)
    : ticket.status === "void"
      ? ticket.stake
      : (ticket.win_amount ?? ticket.potential_win);

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--admin-card)",
        border: `1px solid ${color.border}40`,
        borderLeft: `4px solid ${color.border}`,
      }}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="font-mono text-3xl font-black tracking-[0.15em] text-amber-400">
            {ticket.ticket_code}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {ticket.bet_type?.toUpperCase()} · {ticket.selections_count} selezioni
          </div>
        </div>
        <span
          className="px-4 py-2 rounded-md text-sm font-extrabold"
          style={{ background: color.bg, color: color.text }}
        >
          {v.label}
        </span>
      </div>

      {selections.length > 0 && (
        <div className="mb-4">
          {selections.map((s, i) => (
            <div key={i} className="flex justify-between py-2 border-b border-white/5 text-sm">
              <div>
                <span className="font-bold" style={{ color: "var(--admin-text)" }}>
                  {s.events?.home_team} vs {s.events?.away_team}
                </span>
                {s.events?.score_home != null && (
                  <span className="font-mono text-blue-400 ml-2">
                    {s.events.score_home}-{s.events.score_away}
                  </span>
                )}
              </div>
              <span className="font-mono text-amber-400 font-bold">
                {s.odds_at_placement?.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/10">
        <CellKpi label="Puntata" value={`€${ticket.stake?.toFixed(2)}`} />
        <CellKpi label="Quota" value={ticket.total_odds?.toFixed(2)} />
        <CellKpi
          label={ticket.status === "won" ? "DA PAGARE" : "Vincita Pot."}
          value={`€${(amount ?? 0).toFixed(2)}`}
          highlight={ticket.status === "won"}
        />
      </div>

      <div className="mt-4">
        {payable && (
          <button
            onClick={onPay}
            className="w-full py-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-lg"
          >
            PAGA €{(amount ?? 0).toFixed(2)}
          </button>
        )}
        {ticket.status === "claimed" && (
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 rounded bg-violet-500/20 text-violet-300 text-sm text-center">
              Incassato il {ticket.claimed_at ? new Date(ticket.claimed_at).toLocaleString("it-IT") : "?"}
              {claimedByName ? ` da ${claimedByName}` : ""}
            </div>
            <button onClick={onReprint} className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm">
              Ristampa
            </button>
          </div>
        )}
        {ticket.status === "expired" && canUnlock && (
          <button
            onClick={onUnlockExpired}
            className="w-full py-3 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold"
          >
            Sblocca (super_admin)
          </button>
        )}
        {!payable && ticket.status !== "claimed" && ticket.status !== "expired" && (
          <div className="px-3 py-2 rounded text-sm text-center font-bold" style={{ background: color.bg, color: color.text }}>
            {v.banner}
          </div>
        )}
      </div>
    </div>
  );
}
