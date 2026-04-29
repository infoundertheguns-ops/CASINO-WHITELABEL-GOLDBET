// components/admin/bets/BetsFilters.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import type { BetsListFilters } from "@/lib/types/bets-admin";

const STATUSES = ["all","open","pending_acceptance","won","lost","void","rejected","cashout"];

export function BetsFilters({ initial }: { initial: BetsListFilters }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(initial.search ?? "");

  const setParam = useCallback((k: string, v: string | undefined) => {
    const p = new URLSearchParams(sp);
    if (v == null || v === "") p.delete(k);
    else p.set(k, v);
    p.delete("offset"); // reset pagination on filter change
    router.push(`?${p.toString()}`);
  }, [sp, router]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setParam("search", search.trim() || undefined), 400);
    return () => clearTimeout(t);
  }, [search, setParam]);

  const inputStyle = { padding: "6px 10px", background: "var(--admin-input-bg)", border: "1px solid var(--admin-border)", borderRadius: 4, color: "var(--admin-text)", fontSize: 12 };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select
        value={initial.status ?? "all"}
        onChange={(e) => setParam("status", e.target.value)}
        style={inputStyle as any}
      >
        {STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
      </select>

      <input type="date" value={initial.from ?? ""} onChange={(e) => setParam("from", e.target.value || undefined)} style={inputStyle as any} />
      <input type="date" value={initial.to ?? ""} onChange={(e) => setParam("to", e.target.value || undefined)} style={inputStyle as any} />

      <input type="number" placeholder="€ min" value={initial.min_stake ?? ""}
        onChange={(e) => setParam("min_stake", e.target.value || undefined)} style={{ ...inputStyle, width: 80 } as any} />
      <input type="number" placeholder="€ max" value={initial.max_stake ?? ""}
        onChange={(e) => setParam("max_stake", e.target.value || undefined)} style={{ ...inputStyle, width: 80 } as any} />

      <input type="number" placeholder="Risk min" value={initial.risk_min ?? ""}
        onChange={(e) => setParam("risk_min", e.target.value || undefined)} style={{ ...inputStyle, width: 80 } as any} />
      <input type="number" placeholder="Risk max" value={initial.risk_max ?? ""}
        onChange={(e) => setParam("risk_max", e.target.value || undefined)} style={{ ...inputStyle, width: 80 } as any} />

      <label style={{ fontSize: 12, color: "var(--admin-text)", display: "flex", alignItems: "center", gap: 4 }}>
        <input type="checkbox" checked={!!initial.is_live} onChange={(e) => setParam("is_live", e.target.checked ? "true" : undefined)} />
        Live
      </label>

      <input
        type="search"
        placeholder="🔍 username / id / kiosk code"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...inputStyle, flex: 1, minWidth: 200 } as any}
      />

      <button
        onClick={() => router.push("?")}
        style={{ ...inputStyle, cursor: "pointer", background: "var(--admin-bg)" } as any}
      >Reset</button>
    </div>
  );
}
