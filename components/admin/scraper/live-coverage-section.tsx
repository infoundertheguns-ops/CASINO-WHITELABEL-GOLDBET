"use client";

import { useEffect, useState, useCallback } from "react";
import { coverageColor, coverageBg, formatNumFull } from "./helpers";

interface LiveSportRow {
  name: string;
  slug: string;
  events: number;
  expected: number;
  actual: number;
  coverage_pct: number;
}

interface LiveCoverageData {
  sports: LiveSportRow[];
  totals: {
    events: number;
    expected: number;
    actual: number;
    coverage_pct: number;
  };
}

export function LiveCoverageSection() {
  const [data, setData] = useState<LiveCoverageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/market-coverage?action=live-summary&source=kambi");
      if (resp.ok) setData(await resp.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text3)", fontSize: 14 }}>
        Caricamento coverage live...
      </div>
    );
  }

  if (!data || data.sports.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text3)", fontSize: 14 }}>
        Nessun evento live al momento
      </div>
    );
  }

  const { sports, totals } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <MiniKPI label="Eventi Live" value={formatNumFull(totals.events)} color="#10b981" />
        <MiniKPI label="Attesi" value={formatNumFull(totals.expected)} color="#f59e0b" />
        <MiniKPI label="In DB" value={formatNumFull(totals.actual)} color="#3b82f6" />
        <MiniKPI
          label="Coverage"
          value={`${totals.coverage_pct}%`}
          color={coverageColor(totals.coverage_pct)}
        />
      </div>

      {/* Sport table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--admin-border)" }}>
              {["Sport", "Eventi", "Attesi", "In DB", "Coverage"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 12px",
                    textAlign: h === "Sport" ? "left" : "right",
                    color: "var(--admin-text3)",
                    fontWeight: 600,
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sports.map((s) => (
              <tr
                key={s.slug}
                style={{ borderBottom: "1px solid var(--admin-border)" }}
              >
                <td style={{ padding: "10px 12px", color: "var(--admin-text)", fontWeight: 500 }}>
                  {s.name}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--admin-text2)", fontVariantNumeric: "tabular-nums" }}>
                  {s.events}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", color: "#f59e0b", fontVariantNumeric: "tabular-nums" }}>
                  {formatNumFull(s.expected)}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", color: "#3b82f6", fontVariantNumeric: "tabular-nums" }}>
                  {formatNumFull(s.actual)}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                  <CoverageBadge pct={s.coverage_pct} />
                </td>
              </tr>
            ))}
            {/* Totals row */}
            <tr style={{ background: "rgba(59, 130, 246, 0.06)" }}>
              <td style={{ padding: "10px 12px", color: "var(--admin-text)", fontWeight: 700 }}>
                Totale
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--admin-text)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {totals.events}
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "#f59e0b", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {formatNumFull(totals.expected)}
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "#3b82f6", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {formatNumFull(totals.actual)}
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                <CoverageBadge pct={totals.coverage_pct} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiniKPI({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: "var(--admin-card)",
      border: "1px solid var(--admin-border)",
      borderRadius: 8,
      padding: "12px 16px",
      textAlign: "center",
    }}>
      <div style={{
        fontSize: 11, textTransform: "uppercase", letterSpacing: 1,
        color: "var(--admin-text3)", fontWeight: 600, marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 700, color,
        fontVariantNumeric: "tabular-nums", lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );
}

function CoverageBadge({ pct }: { pct: number }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 6,
      fontSize: 13,
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums",
      color: coverageColor(pct),
      background: coverageBg(pct),
    }}>
      {pct}%
    </span>
  );
}
