"use client";

import { useMemo, useState } from "react";

// Plan D D.1 — Catalog table for /admin/settlement-coverage.
// Sortable + filterable per-market_type table.

type MarketRow = {
  market_type: string;
  category: string;
  sport: string;
  bet_count: number;
  auto_settled: number;
  manual_settled: number;
  void_settled: number;
  pending: number;
  last_seen_at: string;
};

type Props = {
  markets: MarketRow[];
  onRowClick?: (row: MarketRow) => void;
};

type SortKey =
  | "market_type"
  | "category"
  | "sport"
  | "bet_count"
  | "pending"
  | "last_seen_at";

const CATEGORY_BADGE: Record<string, { emoji: string; color: string }> = {
  score: { emoji: "🟢", color: "bg-green-50 text-green-700" },
  stats: { emoji: "🟡", color: "bg-yellow-50 text-yellow-700" },
  player: { emoji: "🔴", color: "bg-red-50 text-red-700" },
  special: { emoji: "🚫", color: "bg-gray-100 text-gray-600" },
  unclassified: { emoji: "⁉️", color: "bg-purple-50 text-purple-700" },
};

export function CatalogTable({ markets, onRowClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("bet_count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [pendingOnly, setPendingOnly] = useState(false);

  const sorted = useMemo(() => {
    let rows = [...markets];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.market_type.toLowerCase().includes(q));
    }
    if (categoryFilter !== "all") {
      rows = rows.filter((r) => r.category === categoryFilter);
    }
    if (pendingOnly) {
      rows = rows.filter((r) => Number(r.pending) > 0);
    }
    rows.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [markets, sortKey, sortDir, search, categoryFilter, pendingOnly]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortHead = ({
    label,
    sortField,
  }: {
    label: string;
    sortField: SortKey;
  }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
      onClick={() => toggleSort(sortField)}
    >
      {label}
      {sortKey === sortField && (
        <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>
      )}
    </th>
  );

  return (
    <div className="bg-card rounded-md shadow-sm border">
      <div className="p-3 border-b flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Cerca market_type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-2 py-1 text-sm flex-1 min-w-[180px]"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="all">All categories</option>
          <option value="score">🟢 score</option>
          <option value="stats">🟡 stats</option>
          <option value="player">🔴 player</option>
          <option value="special">🚫 special</option>
          <option value="unclassified">⁉️ unclassified</option>
        </select>
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
          />
          pending only
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {sorted.length} / {markets.length} righe
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <SortHead label="Market type" sortField="market_type" />
              <SortHead label="Cat." sortField="category" />
              <SortHead label="Sport" sortField="sport" />
              <SortHead label="Bets" sortField="bet_count" />
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">
                Auto / Void
              </th>
              <SortHead label="Pending" sortField="pending" />
              <SortHead label="Last seen" sortField="last_seen_at" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const badge = CATEGORY_BADGE[row.category] ?? CATEGORY_BADGE.unclassified;
              return (
                <tr
                  key={`${row.market_type}-${row.sport}`}
                  className="border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => onRowClick?.(row)}
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.market_type}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs ${badge.color}`}
                    >
                      {badge.emoji} {row.category}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{row.sport}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.bet_count}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.auto_settled}
                    {Number(row.void_settled) > 0 && (
                      <span className="text-gray-400">
                        {" "}
                        / {row.void_settled} void
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(row.pending) > 0 ? (
                      <span className="text-amber-700 font-medium">
                        {row.pending}
                      </span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.last_seen_at
                      ? new Date(row.last_seen_at).toISOString().slice(0, 10)
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-muted-foreground text-sm"
                >
                  No rows match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
