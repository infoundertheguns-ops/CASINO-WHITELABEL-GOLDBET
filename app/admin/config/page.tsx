"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ConfigSection } from "@/components/admin/config/config-section";

export default function AdminConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [system, setSystem] = useState<Record<string, any>>({});
  const [risk, setRisk] = useState<Record<string, any>>({});

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/config");
      const data = await res.json();
      setSystem(data.system || {});
      setRisk(data.risk || {});
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveConfig = async (table: "risk" | "system", key: string, value: any) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, key, value }),
      });
      if (res.ok) {
        setToast("Salvato!");
        setTimeout(() => setToast(null), 2000);
      }
    } catch {}
    setSaving(false);
  };

  const updateRisk = (section: string, key: string, value: any) => {
    setRisk(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const handleSaveThresholds = () => saveConfig("risk", "thresholds", risk.thresholds);
  const handleSaveAutoActions = () => saveConfig("risk", "auto_actions", risk.auto_actions);
  const handleSaveRules = () => saveConfig("risk", "rules", risk.rules);
  const handleSaveAI = () => saveConfig("risk", "ai_settings", risk.ai_settings);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: "var(--admin-text4)" }}>Caricamento configurazione...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "var(--admin-text)" }}>Configurazione</h1>
          <p className="text-sm" style={{ color: "var(--admin-text4)" }}>Gestione soglie rischio, regole e impostazioni piattaforma</p>
        </div>
        {toast && (
          <div className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-bold">
            {toast}
          </div>
        )}
      </div>

      <div className="space-y-6">
        {/* Risk Thresholds */}
        <div>
          <ConfigSection
            title="Soglie Rischio"
            description="Punteggi soglia per azioni automatiche del risk engine"
            fields={[
              { key: "auto_block", label: "Auto-Block Account", type: "number", min: 0, max: 100 },
              { key: "auto_reduce_limits", label: "Auto-Riduzione Limiti", type: "number", min: 0, max: 100 },
              { key: "auto_flag", label: "Auto-Flag per Review", type: "number", min: 0, max: 100 },
              { key: "auto_kyc", label: "Auto-Richiesta KYC", type: "number", min: 0, max: 100 },
              { key: "ai_threshold", label: "Soglia Analisi AI", type: "number", min: 0, max: 100 },
            ]}
            values={risk.thresholds || {}}
            onChange={(key, value) => updateRisk("thresholds", key, value)}
          />
          <button onClick={handleSaveThresholds} disabled={saving}
            className="mt-3 px-4 py-2 rounded-lg bg-brand/20 text-brand text-xs font-bold hover:bg-brand/30 disabled:opacity-50">
            Salva Soglie
          </button>
        </div>

        {/* Auto Actions */}
        <div>
          <ConfigSection
            title="Azioni Automatiche"
            description="Abilita/disabilita azioni automatiche del risk engine"
            fields={[
              { key: "enabled", label: "Auto-Actions Attive", type: "toggle" },
              { key: "block_account", label: "Blocca Account Automatico", type: "toggle" },
              { key: "reduce_limits", label: "Riduci Limiti Automatico", type: "toggle" },
              { key: "require_kyc", label: "Richiedi KYC Automatico", type: "toggle" },
              { key: "notify_admin", label: "Notifica Admin", type: "toggle" },
            ]}
            values={risk.auto_actions || {}}
            onChange={(key, value) => updateRisk("auto_actions", key, value)}
          />
          <button onClick={handleSaveAutoActions} disabled={saving}
            className="mt-3 px-4 py-2 rounded-lg bg-brand/20 text-brand text-xs font-bold hover:bg-brand/30 disabled:opacity-50">
            Salva Azioni
          </button>
        </div>

        {/* Rule Parameters */}
        <div>
          <ConfigSection
            title="Parametri Regole"
            description="Valori soglia per le 12 regole del risk engine"
            fields={[
              { key: "stake_spike_multiplier", label: "Spike Stake (moltiplicatore)", type: "number", min: 1, max: 20 },
              { key: "high_stake", label: "High Stake ($)", type: "number", min: 100, max: 50000, step: 100 },
              { key: "very_high_stake", label: "Very High Stake ($)", type: "number", min: 500, max: 100000, step: 500 },
              { key: "new_account_days", label: "Account Nuovo (giorni)", type: "number", min: 1, max: 30 },
              { key: "young_account_days", label: "Account Giovane (giorni)", type: "number", min: 1, max: 90 },
              { key: "high_odds", label: "Quota Alta", type: "number", min: 5, max: 100 },
              { key: "extreme_odds", label: "Quota Estrema", type: "number", min: 10, max: 200 },
              { key: "velocity_1h", label: "Velocity Alert (bet/h)", type: "number", min: 3, max: 50 },
              { key: "extreme_velocity_1h", label: "Velocity Estrema (bet/h)", type: "number", min: 10, max: 100 },
              { key: "win_rate_threshold", label: "Win Rate Soglia", type: "number", min: 0.5, max: 1, step: 0.05 },
              { key: "win_rate_min_bets", label: "Min Bet per Win Rate", type: "number", min: 5, max: 100 },
              { key: "unverified_stake", label: "Stake Max Unverified ($)", type: "number", min: 50, max: 5000, step: 50 },
            ]}
            values={risk.rules || {}}
            onChange={(key, value) => updateRisk("rules", key, value)}
          />
          <button onClick={handleSaveRules} disabled={saving}
            className="mt-3 px-4 py-2 rounded-lg bg-brand/20 text-brand text-xs font-bold hover:bg-brand/30 disabled:opacity-50">
            Salva Regole
          </button>
        </div>

        {/* AI Settings */}
        <div>
          <ConfigSection
            title="Impostazioni AI"
            description="Configurazione del modello Claude per analisi rischio"
            fields={[
              { key: "enabled", label: "AI Analisi Attiva", type: "toggle" },
              { key: "model", label: "Modello", type: "select", options: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"] },
              { key: "max_tokens", label: "Max Tokens", type: "number", min: 500, max: 4000, step: 100 },
              { key: "auto_analyze_above", label: "Auto-Analisi Sopra Score", type: "number", min: 0, max: 100 },
            ]}
            values={risk.ai_settings || {}}
            onChange={(key, value) => updateRisk("ai_settings", key, value)}
          />
          <button onClick={handleSaveAI} disabled={saving}
            className="mt-3 px-4 py-2 rounded-lg bg-brand/20 text-brand text-xs font-bold hover:bg-brand/30 disabled:opacity-50">
            Salva AI Settings
          </button>
        </div>
      </div>
    </div>
  );
}
