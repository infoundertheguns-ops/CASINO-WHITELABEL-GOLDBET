// app/admin/bets/[id]/page.tsx
"use client";
import { useEffect, useState } from "react";
import type { BetDetailResponse } from "@/lib/types/bets-admin";
import { BetCard } from "@/components/admin/bets/BetCard";
import { BetSelections } from "@/components/admin/bets/BetSelections";
import { BetMetadata } from "@/components/admin/bets/BetMetadata";
import { BetRiskPanel } from "@/components/admin/bets/BetRiskPanel";
import { BetEventLog } from "@/components/admin/bets/BetEventLog";
import { BetTicket } from "@/components/admin/bets/BetTicket";

function BackLink() {
  return (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); window.history.back(); }}
      style={{ color: "#60a5fa", fontSize: 13 }}
    >
      ← Indietro
    </a>
  );
}

export default function BetDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<BetDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/bets/${params.id}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => ok ? setData(j) : setError(j.error || "Errore"))
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (error) return <div style={{ padding: 20, color: "#ef4444" }}>{error} <BackLink /></div>;
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text4)" }}>Caricamento…</div>;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <BackLink />
        <code style={{ fontSize: 11, color: "var(--admin-text4)" }}>Bet ID: {data.bet.id}</code>
      </div>

      {/* Top section: betslip receipt + summary side-by-side */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "start" }}>
        <BetTicket bet={data.bet} selections={data.selections} user={data.user} kiosk={data.kiosk} agent={data.agent} />
        <BetCard bet={data.bet} />
      </div>

      <BetSelections selections={data.selections} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, textTransform: "uppercase" }}>👤 PLAYER</div>
          <div style={{ fontSize: 13 }}>Username: <strong>{data.user.username ?? "—"}</strong></div>
          <div style={{ fontSize: 11, color: "var(--admin-text4)" }}>ID: <code>{data.user.id}</code></div>
          <div style={{ fontSize: 12, marginTop: 4 }}>KYC: {data.user.kyc_status ?? "—"} • Country: {data.user.country ?? "—"}</div>
        </div>
        <BetRiskPanel risk={data.risk} bet={data.bet} />
      </div>

      <BetMetadata bet={data.bet} kiosk={data.kiosk} agent={data.agent} risk={data.risk} />

      {data.children_combos.length > 0 && (
        <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, textTransform: "uppercase" }}>🔢 COMBINAZIONI ({data.children_combos.length})</div>
          {data.children_combos.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--admin-border)" }}>
              <span><code>{c.id.split("-")[0]}</code> • {c.selections_count} legs</span>
              <span>€{c.stake} @ {c.total_odds?.toFixed(2)} → €{c.actual_win ?? c.potential_win?.toFixed(2) ?? "—"} <strong>{c.status.toUpperCase()}</strong></span>
            </div>
          ))}
        </div>
      )}

      <BetEventLog entries={data.event_log} />
    </div>
  );
}
