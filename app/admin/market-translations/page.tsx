"use client";

import { useState, useEffect, useCallback } from "react";

interface MarketRow {
  market_type: string;
  count: number;
  is_italian: boolean;
}

interface TranslationData {
  source: string;
  total_types: number;
  italian_types: number;
  english_types: number;
  total_markets: number;
  italian_markets: number;
  coverage_pct: number;
  markets: MarketRow[];
}

export default function MarketTranslationsPage() {
  const [data, setData] = useState<TranslationData | null>(null);
  const [source, setSource] = useState<"kambi">("kambi");
  const [filter, setFilter] = useState<"all" | "italian" | "english">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/market-translations?source=${source}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [source]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = data?.markets?.filter((m) => {
    if (filter === "italian" && !m.is_italian) return false;
    if (filter === "english" && m.is_italian) return false;
    if (search && !m.market_type.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }) || [];

  const kpiStyle: React.CSSProperties = {
    background: "#0f1a2e",
    border: "1px solid #1e3a5f",
    borderRadius: 8,
    padding: "16px 20px",
    textAlign: "center",
    minWidth: 140,
  };

  const kpiLabel: React.CSSProperties = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#64748b",
    marginBottom: 4,
  };

  const kpiValue: React.CSSProperties = {
    fontSize: 28,
    fontWeight: 700,
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>
          Traduzioni Mercati
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
            <span
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: "1px solid #1e3a5f",
                background: "#1e40af",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              KAMBI
            </span>
          <button
            onClick={fetchData}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "1px solid #1e3a5f",
              background: "#0f1a2e",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Aggiorna
          </button>
        </div>
      </div>

      {/* KPI Bar */}
      {data && (
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <div style={kpiStyle}>
            <div style={kpiLabel}>Copertura IT</div>
            <div style={{
              ...kpiValue,
              color: data.coverage_pct >= 90 ? "#22c55e" : data.coverage_pct >= 70 ? "#eab308" : "#ef4444",
            }}>
              {data.coverage_pct}%
            </div>
          </div>
          <div style={kpiStyle}>
            <div style={kpiLabel}>Tipi Totali</div>
            <div style={{ ...kpiValue, color: "#e2e8f0" }}>{data.total_types}</div>
          </div>
          <div style={kpiStyle}>
            <div style={kpiLabel}>Tipi IT</div>
            <div style={{ ...kpiValue, color: "#22c55e" }}>{data.italian_types}</div>
          </div>
          <div style={kpiStyle}>
            <div style={kpiLabel}>Tipi EN</div>
            <div style={{ ...kpiValue, color: "#ef4444" }}>{data.english_types}</div>
          </div>
          <div style={kpiStyle}>
            <div style={kpiLabel}>Market Totali</div>
            <div style={{ ...kpiValue, color: "#e2e8f0" }}>{data.total_markets.toLocaleString()}</div>
          </div>
          <div style={kpiStyle}>
            <div style={kpiLabel}>Market IT</div>
            <div style={{ ...kpiValue, color: "#22c55e" }}>{data.italian_markets.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Cerca market type..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #1e3a5f",
            background: "#0a1929",
            color: "#e2e8f0",
            fontSize: 13,
            flex: 1,
            maxWidth: 300,
          }}
        />
        {(["all", "english", "italian"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #1e3a5f",
              background: filter === f ? (f === "english" ? "#991b1b" : f === "italian" ? "#166534" : "#1e3a5f") : "#0f1a2e",
              color: filter === f ? "#fff" : "#94a3b8",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {f === "all" ? `Tutti (${data?.markets?.length || 0})` : f === "english" ? `EN (${data?.english_types || 0})` : `IT (${data?.italian_types || 0})`}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #1e3a5f" }}>
                <th style={{ textAlign: "left", padding: "10px 12px", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>#</th>
                <th style={{ textAlign: "left", padding: "10px 12px", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Market Type</th>
                <th style={{ textAlign: "center", padding: "10px 12px", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Lingua</th>
                <th style={{ textAlign: "right", padding: "10px 12px", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Conteggio</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr
                  key={m.market_type}
                  style={{
                    borderBottom: "1px solid #1e293b",
                    background: i % 2 === 0 ? "transparent" : "#0a1a30",
                  }}
                >
                  <td style={{ padding: "8px 12px", color: "#475569" }}>{i + 1}</td>
                  <td style={{
                    padding: "8px 12px",
                    color: m.is_italian ? "#e2e8f0" : "#fbbf24",
                    fontFamily: "monospace",
                    fontSize: 13,
                  }}>
                    {m.market_type}
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 12px" }}>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 10px",
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      background: m.is_italian ? "#052e1633" : "#3b0a0a66",
                      color: m.is_italian ? "#22c55e" : "#ef4444",
                      border: `1px solid ${m.is_italian ? "#166534" : "#991b1b"}`,
                    }}>
                      {m.is_italian ? "IT" : "EN"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", padding: "8px 12px", color: "#94a3b8", fontFamily: "monospace" }}>
                    {m.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>
              Nessun mercato trovato
            </div>
          )}
        </div>
      )}
    </div>
  );
}
