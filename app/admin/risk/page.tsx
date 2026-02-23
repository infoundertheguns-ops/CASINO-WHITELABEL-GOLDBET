"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { RiskKPIs } from "@/components/admin/risk/risk-kpis";
import { RiskScoreChart } from "@/components/admin/risk/risk-score-chart";
import { AlertsTimeline } from "@/components/admin/risk/alerts-timeline";
import { SportRiskChart } from "@/components/admin/risk/sport-risk-chart";
import { FlaggedUsersTable } from "@/components/admin/risk/flagged-users-table";
import { AIAnalysisPanel } from "@/components/admin/risk/ai-analysis-panel";

type Tab = "dashboard" | "alerts" | "users" | "ai";

export default function AdminRiskAgent() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertFilter, setAlertFilter] = useState({ severity: "", status: "" });
  const [users, setUsers] = useState<any[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const supabase = createClient();

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/risk?tab=overview");
      const data = await res.json();
      setOverview(data);
    } catch {}
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tab: "alerts", page: String(alertsPage), limit: "20" });
      if (alertFilter.severity) params.set("severity", alertFilter.severity);
      if (alertFilter.status) params.set("status", alertFilter.status);
      const res = await fetch(`/api/admin/risk?${params}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
      setAlertsTotal(data.total || 0);
    } catch {}
  }, [alertsPage, alertFilter]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/risk?tab=users&page=${usersPage}&limit=20`);
      const data = await res.json();
      setUsers(data.users || []);
      setUsersTotal(data.total || 0);
    } catch {}
  }, [usersPage]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadOverview()]).finally(() => setLoading(false));
  }, [loadOverview]);

  useEffect(() => {
    if (tab === "alerts") loadAlerts();
  }, [tab, loadAlerts]);

  useEffect(() => {
    if (tab === "users") loadUsers();
  }, [tab, loadUsers]);

  // Realtime subscription for risk_flags
  useEffect(() => {
    const channel = supabase
      .channel("risk-flags-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "risk_flags" }, () => {
        loadOverview();
        if (tab === "alerts") loadAlerts();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tab, loadOverview, loadAlerts, supabase]);

  const handleResolveAlert = async (id: string, status: string) => {
    try {
      await fetch("/api/admin/risk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status } : a));
      loadOverview();
    } catch {}
  };

  const handleAIAnalyze = async (id: string, type: "bet" | "user") => {
    const res = await fetch("/api/risk-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet_id: id, use_ai: true }),
    });
    if (!res.ok) throw new Error("Analisi fallita");
    return res.json();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "alerts", label: "Alert" },
    { id: "users", label: "Utenti Flaggati" },
    { id: "ai", label: "AI Analysis" },
  ];

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Caricamento...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "var(--admin-text)" }}>AI Risk Agent</h1>
          <p className="text-sm" style={{ color: "var(--admin-text4)" }}>Monitoraggio rischio in tempo reale con AI avanzata</p>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 rounded-lg p-1 w-fit" style={{ background: "var(--admin-card)" }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2 rounded-md text-xs font-bold transition-colors",
              tab === t.id ? "bg-brand/20 text-brand" : "text-gray-500 hover:text-white"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Dashboard */}
      {tab === "dashboard" && overview && (
        <div className="space-y-4">
          <RiskKPIs
            openAlerts={overview.kpis?.open_alerts || 0}
            criticalAlerts={overview.kpis?.critical_alerts || 0}
            avgScore={overview.kpis?.avg_score || 0}
            flaggedUsers={overview.kpis?.flagged_users || 0}
            blockedToday={overview.kpis?.blocked_today || 0}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RiskScoreChart distribution={overview.distribution || { low: 0, medium: 0, high: 0, critical: 0 }} />
            <SportRiskChart data={overview.sport_risk || []} />
          </div>

          <AlertsTimeline
            alerts={overview.recent_alerts || []}
            onResolve={handleResolveAlert}
          />
        </div>
      )}

      {/* Tab: Alerts */}
      {tab === "alerts" && (
        <div className="space-y-4">
          <div className="flex gap-3 items-center">
            <select
              value={alertFilter.severity}
              onChange={e => { setAlertFilter(f => ({ ...f, severity: e.target.value })); setAlertsPage(1); }}
              className="border border-gray-700 rounded-lg px-3 py-2 text-xs"
              style={{ background: "var(--admin-card)", color: "var(--admin-text)" }}
            >
              <option value="">Tutte le severity</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={alertFilter.status}
              onChange={e => { setAlertFilter(f => ({ ...f, status: e.target.value })); setAlertsPage(1); }}
              className="border border-gray-700 rounded-lg px-3 py-2 text-xs"
              style={{ background: "var(--admin-card)", color: "var(--admin-text)" }}
            >
              <option value="">Tutti gli status</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
              <option value="escalated">Escalated</option>
            </select>
            <span className="text-[10px] ml-auto" style={{ color: "var(--admin-text4)" }}>{alertsTotal} risultati</span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--admin-text4)", borderBottom: "1px solid var(--admin-border)" }}>
                    <th className="text-left px-4 py-2 font-semibold">Severity</th>
                    <th className="text-left px-4 py-2 font-semibold">Utente</th>
                    <th className="text-left px-4 py-2 font-semibold">Tipo</th>
                    <th className="text-left px-4 py-2 font-semibold">Descrizione</th>
                    <th className="text-center px-4 py-2 font-semibold">Status</th>
                    <th className="text-right px-4 py-2 font-semibold">Data</th>
                    <th className="text-center px-4 py-2 font-semibold">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(a => (
                    <tr key={a.id} className="border-b border-gray-800/50 hover:bg-white/5">
                      <td className="px-4 py-2">
                        <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold",
                          a.severity === "critical" ? "bg-red-500/20 text-red-400" :
                          a.severity === "high" ? "bg-orange-500/20 text-orange-400" :
                          a.severity === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-green-500/20 text-green-400"
                        )}>{a.severity?.toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-2" style={{ color: "var(--admin-text)" }}>{a.users?.username || "—"}</td>
                      <td className="px-4 py-2" style={{ color: "var(--admin-text3)" }}>{a.flag_type}</td>
                      <td className="px-4 py-2 max-w-xs truncate" style={{ color: "var(--admin-text3)" }}>{a.description}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={cn("text-[8px] font-bold",
                          a.status === "open" ? "text-yellow-400" :
                          a.status === "resolved" ? "text-emerald-400" :
                          a.status === "escalated" ? "text-red-400" :
                          "text-gray-500"
                        )}>{a.status?.toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">
                        {new Date(a.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {a.status === "open" && (
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => handleResolveAlert(a.id, "resolved")} className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[8px] font-bold">Risolvi</button>
                            <button onClick={() => handleResolveAlert(a.id, "dismissed")} className="px-2 py-0.5 rounded bg-gray-500/20 text-gray-400 text-[8px] font-bold">Ignora</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {alertsTotal > 20 && (
              <div className="px-4 py-3 border-t border-gray-800 flex gap-2 justify-center">
                <button
                  onClick={() => setAlertsPage(p => Math.max(1, p - 1))}
                  disabled={alertsPage === 1}
                  className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30"
                >Prec</button>
                <span className="text-xs text-gray-500 px-3 py-1">Pagina {alertsPage}</span>
                <button
                  onClick={() => setAlertsPage(p => p + 1)}
                  disabled={alertsPage * 20 >= alertsTotal}
                  className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30"
                >Succ</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Flagged Users */}
      {tab === "users" && (
        <div className="space-y-4">
          <FlaggedUsersTable users={users} />
          {usersTotal > 20 && (
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setUsersPage(p => Math.max(1, p - 1))}
                disabled={usersPage === 1}
                className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30"
              >Prec</button>
              <span className="text-xs text-gray-500 px-3 py-1">Pagina {usersPage} / {Math.ceil(usersTotal / 20)}</span>
              <button
                onClick={() => setUsersPage(p => p + 1)}
                disabled={usersPage * 20 >= usersTotal}
                className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30"
              >Succ</button>
            </div>
          )}
        </div>
      )}

      {/* Tab: AI Analysis */}
      {tab === "ai" && (
        <AIAnalysisPanel onAnalyze={handleAIAnalyze} />
      )}
    </div>
  );
}
