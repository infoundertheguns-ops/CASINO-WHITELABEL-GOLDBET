"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Kpi, KpiRow } from "@/components/admin/ui/kpi";

interface Voucher {
  id: string;
  code: string;
  amount: number;
  status: "pending" | "redeemed" | "expired" | "voided";
  created_at: string;
  redeemed_at: string | null;
  notes: string | null;
  kiosk: { id: string; code: string; name: string } | null;
  redeemed_admin: { id: string; username: string } | null;
}

interface Kpi {
  pending: number;
  today_redeemed_count: number;
  today_redeemed_amount: number;
}

export default function KioskVouchersPage() {
  const [scan, setScan] = useState("");
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [kpi, setKpi] = useState<Kpi>({ pending: 0, today_redeemed_count: 0, today_redeemed_amount: 0 });
  const [statusFilter, setStatusFilter] = useState<"pending" | "redeemed" | "all">("pending");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [activeVoucher, setActiveVoucher] = useState<Voucher | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/kiosk-vouchers?status=${statusFilter}`);
      const data = await res.json();
      if (res.ok) {
        setVouchers(data.vouchers);
        setKpi(data.kpi);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Auto-focus scanner input
  useEffect(() => {
    scanRef.current?.focus();
  }, [activeVoucher]);

  const lookup = useCallback(async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/kiosk-vouchers/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", text: data.error === "NOT_FOUND" ? `Voucher ${code} non trovato` : data.error });
        setActiveVoucher(null);
        return;
      }
      setActiveVoucher(data);
      setScan("");
    } catch (e) {
      setFeedback({ type: "error", text: e instanceof Error ? e.message : "Errore di rete" });
    }
  }, []);

  const redeem = useCallback(async () => {
    if (!activeVoucher) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/kiosk-vouchers/${activeVoucher.code}/redeem`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        const text =
          data.error === "ALREADY_REDEEMED"
            ? `Voucher GIÀ RISCOSSO il ${data.detail ? new Date(data.detail).toLocaleString("it-IT") : "in precedenza"}`
            : data.error === "INVALID_STATUS"
              ? `Stato non valido: ${data.detail}`
              : data.error === "NOT_FOUND"
                ? "Voucher non trovato"
                : data.error;
        setFeedback({ type: "error", text });
        return;
      }
      setFeedback({ type: "success", text: `Pagato € ${Number(data.amount).toFixed(2)} — voucher ${data.code}` });
      setActiveVoucher(null);
      loadList();
    } catch (e) {
      setFeedback({ type: "error", text: e instanceof Error ? e.message : "Errore di rete" });
    }
    setLoading(false);
  }, [activeVoucher, loadList]);

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16, color: "var(--admin-text)" }}>
        Cassa — Voucher Cashout Kiosk
      </h1>

      <KpiRow minWidth={200}>
        <Kpi label="Voucher in Attesa" value={kpi.pending} accent="#f59e0b" />
        <Kpi label="Riscossi Oggi (n.)" value={kpi.today_redeemed_count} accent="#10b981" />
        <Kpi label="Riscossi Oggi (€)" value={`€ ${kpi.today_redeemed_amount.toFixed(2)}`} accent="#10b981" />
      </KpiRow>

      {/* Scanner input */}
      <div style={{
        marginTop: 16,
        padding: 16,
        border: "1px solid var(--admin-border)",
        borderRadius: 10,
        background: "var(--admin-card)",
      }}>
        <label style={{ fontSize: 11, color: "var(--admin-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
          Scansiona voucher
        </label>
        <form
          onSubmit={(e) => { e.preventDefault(); lookup(scan); }}
          style={{ display: "flex", gap: 8, marginTop: 6 }}
        >
          <input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            placeholder="Codice voucher (10 caratteri)"
            autoFocus
            style={{
              flex: 1,
              fontSize: 24,
              fontFamily: "monospace",
              letterSpacing: "0.15em",
              padding: "10px 14px",
              border: "1px solid var(--admin-border)",
              borderRadius: 6,
              background: "var(--admin-input)",
              color: "var(--admin-text)",
              textTransform: "uppercase",
            }}
          />
          <button
            type="submit"
            disabled={!scan.trim()}
            style={{
              padding: "10px 18px",
              fontWeight: 800,
              background: "#8b5cf6",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: scan.trim() ? "pointer" : "not-allowed",
              opacity: scan.trim() ? 1 : 0.5,
            }}
          >
            CERCA
          </button>
        </form>
      </div>

      {/* Feedback */}
      {feedback && (
        <div style={{
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 8,
          background: feedback.type === "success" ? "#064e3b" : "#7f1d1d",
          color: feedback.type === "success" ? "#a7f3d0" : "#fecaca",
          fontWeight: 700,
        }}>
          {feedback.text}
        </div>
      )}

      {/* Active voucher detail */}
      {activeVoucher && (
        <div style={{
          marginTop: 16,
          padding: 20,
          border: "2px solid " + (activeVoucher.status === "pending" ? "#f59e0b" : "#64748b"),
          borderRadius: 10,
          background: "var(--admin-card)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--admin-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Voucher
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace", letterSpacing: "0.1em", color: "var(--admin-text)" }}>
                {activeVoucher.code}
              </div>
            </div>
            <div style={{
              fontSize: 36,
              fontWeight: 900,
              color: activeVoucher.status === "pending" ? "#f59e0b" : "#64748b",
              fontVariantNumeric: "tabular-nums",
            }}>
              € {Number(activeVoucher.amount).toFixed(2)}
            </div>
          </div>

          <div style={{ fontSize: 13, color: "var(--admin-text-muted)", marginBottom: 12 }}>
            <div>Terminale: <b>{activeVoucher.kiosk?.name || activeVoucher.kiosk?.code || "—"}</b></div>
            <div>Creato: {new Date(activeVoucher.created_at).toLocaleString("it-IT")}</div>
            <div>Stato: <b style={{ color: activeVoucher.status === "pending" ? "#f59e0b" : "#64748b" }}>
              {activeVoucher.status.toUpperCase()}
            </b></div>
            {activeVoucher.redeemed_at && (
              <div>
                Riscosso: {new Date(activeVoucher.redeemed_at).toLocaleString("it-IT")}
                {activeVoucher.redeemed_admin && ` da ${activeVoucher.redeemed_admin.username}`}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {activeVoucher.status === "pending" && (
              <button
                onClick={redeem}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  fontSize: 16,
                  fontWeight: 800,
                  background: "#10b981",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: loading ? "wait" : "pointer",
                  textTransform: "uppercase",
                }}
              >
                {loading ? "In corso..." : "✓ PAGA E RISCUOTI"}
              </button>
            )}
            <button
              onClick={() => setActiveVoucher(null)}
              style={{
                padding: "12px 16px",
                fontWeight: 700,
                background: "var(--admin-input)",
                color: "var(--admin-text)",
                border: "1px solid var(--admin-border)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Chiudi
            </button>
          </div>
        </div>
      )}

      {/* Status filter */}
      <div style={{ marginTop: 24, display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--admin-text-muted)", fontWeight: 700, textTransform: "uppercase" }}>
          Filtro:
        </span>
        {(["pending", "redeemed", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              background: statusFilter === s ? "#8b5cf6" : "var(--admin-input)",
              color: statusFilter === s ? "white" : "var(--admin-text)",
              border: "1px solid var(--admin-border)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {s === "pending" ? "In attesa" : s === "redeemed" ? "Riscossi" : "Tutti"}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--admin-text-muted)" }}>
          {vouchers.length} risultati
        </span>
      </div>

      {/* Voucher list table */}
      <div style={{
        marginTop: 8,
        border: "1px solid var(--admin-border)",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--admin-card)",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--admin-input)", textAlign: "left" }}>
              <th style={{ padding: "10px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Codice</th>
              <th style={{ padding: "10px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", color: "var(--admin-text-muted)", textAlign: "right" }}>Importo</th>
              <th style={{ padding: "10px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Terminale</th>
              <th style={{ padding: "10px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Stato</th>
              <th style={{ padding: "10px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Creato</th>
              <th style={{ padding: "10px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Riscosso</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun voucher</td></tr>
            )}
            {vouchers.map((v) => (
              <tr
                key={v.id}
                onClick={() => lookup(v.code)}
                style={{
                  borderTop: "1px solid var(--admin-border)",
                  cursor: "pointer",
                  background: activeVoucher?.id === v.id ? "rgba(139,92,246,0.12)" : undefined,
                }}
              >
                <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: "var(--admin-text)" }}>{v.code}</td>
                <td style={{ padding: "10px 12px", fontWeight: 800, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--admin-text)" }}>
                  € {Number(v.amount).toFixed(2)}
                </td>
                <td style={{ padding: "10px 12px", color: "var(--admin-text-muted)" }}>{v.kiosk?.name || v.kiosk?.code || "—"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    background: v.status === "pending" ? "#422006" : v.status === "redeemed" ? "#064e3b" : "#334155",
                    color: v.status === "pending" ? "#fbbf24" : v.status === "redeemed" ? "#34d399" : "#cbd5e1",
                  }}>
                    {v.status}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", color: "var(--admin-text-muted)" }}>
                  {new Date(v.created_at).toLocaleString("it-IT")}
                </td>
                <td style={{ padding: "10px 12px", color: "var(--admin-text-muted)" }}>
                  {v.redeemed_at ? new Date(v.redeemed_at).toLocaleString("it-IT") : "—"}
                  {v.redeemed_admin && <div style={{ fontSize: 10 }}>{v.redeemed_admin.username}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
