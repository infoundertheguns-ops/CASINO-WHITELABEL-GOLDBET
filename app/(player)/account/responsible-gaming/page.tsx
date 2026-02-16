"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function ResponsibleGamingPage() {
  const { user } = useAuth();
  const supabase = createClient();

  const [limits, setLimits] = useState({
    daily_deposit: "",
    weekly_deposit: "",
    monthly_deposit: "",
    daily_loss: "",
    weekly_loss: "",
    session_time: "", // minutes
    cooldown_hours: "",
  });
  const [selfExclude, setSelfExclude] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentLimits, setCurrentLimits] = useState<any>(null);

  useEffect(() => {
    if (user) loadLimits();
  }, [user]);

  const loadLimits = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_limits")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (data) {
      setCurrentLimits(data);
      setLimits({
        daily_deposit: data.daily_deposit_limit?.toString() || "",
        weekly_deposit: data.weekly_deposit_limit?.toString() || "",
        monthly_deposit: data.monthly_deposit_limit?.toString() || "",
        daily_loss: data.daily_loss_limit?.toString() || "",
        weekly_loss: data.weekly_loss_limit?.toString() || "",
        session_time: data.session_time_limit?.toString() || "",
        cooldown_hours: data.cooldown_hours?.toString() || "",
      });
    }
  };

  const saveLimits = async () => {
    if (!user) return;
    setSaving(true);

    const limitData = {
      user_id: user.id,
      daily_deposit_limit: limits.daily_deposit ? parseFloat(limits.daily_deposit) : null,
      weekly_deposit_limit: limits.weekly_deposit ? parseFloat(limits.weekly_deposit) : null,
      monthly_deposit_limit: limits.monthly_deposit ? parseFloat(limits.monthly_deposit) : null,
      daily_loss_limit: limits.daily_loss ? parseFloat(limits.daily_loss) : null,
      weekly_loss_limit: limits.weekly_loss ? parseFloat(limits.weekly_loss) : null,
      session_time_limit: limits.session_time ? parseInt(limits.session_time) : null,
      cooldown_hours: limits.cooldown_hours ? parseInt(limits.cooldown_hours) : null,
    };

    await supabase.from("user_limits").upsert(limitData, { onConflict: "user_id" });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleSelfExclude = async () => {
    if (!user || !selfExclude) return;
    setSaving(true);

    const days = selfExclude === "permanent" ? 36500 : parseInt(selfExclude);
    const until = new Date(Date.now() + days * 86400000);

    await supabase.from("users").update({
      is_banned: true,
      ban_reason: `Autoesclusione ${selfExclude === "permanent" ? "permanente" : selfExclude + " giorni"}`,
      banned_at: new Date().toISOString(),
    }).eq("id", user.id);

    await supabase.from("user_limits").upsert({
      user_id: user.id,
      self_exclusion_until: until.toISOString(),
      self_exclusion_type: selfExclude,
    }, { onConflict: "user_id" });

    setSaving(false);
    alert("Account auto-escluso. Non potrai accedere fino alla scadenza. Contatta il supporto per assistenza.");
  };

  return (
    <div className="p-4 lg:p-0 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">🛡️ Gioco Responsabile</h1>
        <p className="text-xs text-gray-400 mt-1">Imposta limiti per gestire la tua attività di gioco in modo sicuro</p>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
        <p className="text-xs text-blue-700">
          Il gioco deve essere un divertimento. Se senti di non avere più il controllo, i limiti e l'autoesclusione possono aiutarti.
          Puoi anche contattare il servizio di supporto 24/7.
        </p>
      </div>

      {/* Deposit Limits */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <h3 className="text-sm font-bold text-gray-900 mb-3">💰 Limiti di Deposito</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: "daily_deposit", label: "Giornaliero" },
            { key: "weekly_deposit", label: "Settimanale" },
            { key: "monthly_deposit", label: "Mensile" },
          ].map(f => (
            <div key={f.key}>
              <label className="text-[10px] text-gray-400 font-semibold block mb-1">{f.label}</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                <input type="number" value={(limits as any)[f.key]}
                  onChange={(e) => setLimits({ ...limits, [f.key]: e.target.value })}
                  placeholder="—"
                  className="w-full pl-6 pr-2 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Loss Limits */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <h3 className="text-sm font-bold text-gray-900 mb-3">📉 Limiti di Perdita</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "daily_loss", label: "Perdita Giornaliera Max" },
            { key: "weekly_loss", label: "Perdita Settimanale Max" },
          ].map(f => (
            <div key={f.key}>
              <label className="text-[10px] text-gray-400 font-semibold block mb-1">{f.label}</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                <input type="number" value={(limits as any)[f.key]}
                  onChange={(e) => setLimits({ ...limits, [f.key]: e.target.value })}
                  placeholder="—"
                  className="w-full pl-6 pr-2 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Session Limits */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <h3 className="text-sm font-bold text-gray-900 mb-3">⏱️ Limiti di Sessione</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-gray-400 font-semibold block mb-1">Durata Sessione (minuti)</label>
            <input type="number" value={limits.session_time}
              onChange={(e) => setLimits({ ...limits, session_time: e.target.value })}
              placeholder="es. 60"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 font-semibold block mb-1">Pausa Obbligatoria (ore)</label>
            <input type="number" value={limits.cooldown_hours}
              onChange={(e) => setLimits({ ...limits, cooldown_hours: e.target.value })}
              placeholder="es. 24"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand" />
          </div>
        </div>
      </div>

      {/* Save */}
      {saved && <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-600 text-xs text-center font-semibold">✅ Limiti salvati</div>}
      <button onClick={saveLimits} disabled={saving}
        className="w-full py-3 rounded-xl bg-brand text-white text-sm font-bold mb-6 hover:bg-brand-dark disabled:opacity-50">
        {saving ? "⏳ Salvataggio..." : "Salva Limiti"}
      </button>

      {/* Self-Exclusion */}
      <div className="bg-red-50 rounded-xl border border-red-200 p-5">
        <h3 className="text-sm font-bold text-red-700 mb-2">⚠️ Autoesclusione</h3>
        <p className="text-[10px] text-red-600 mb-3">
          L'autoesclusione è irreversibile per il periodo selezionato. Non potrai accedere al tuo account né giocare fino alla scadenza.
        </p>
        <div className="flex gap-2 mb-3 flex-wrap">
          {[
            { value: "1", label: "24 ore" },
            { value: "7", label: "7 giorni" },
            { value: "30", label: "30 giorni" },
            { value: "90", label: "90 giorni" },
            { value: "180", label: "6 mesi" },
            { value: "permanent", label: "Permanente" },
          ].map(opt => (
            <button key={opt.value} onClick={() => setSelfExclude(selfExclude === opt.value ? null : opt.value)}
              className={cn("px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                selfExclude === opt.value ? "bg-red-500 text-white border-red-500" : "bg-white text-red-600 border-red-300 hover:border-red-400"
              )}>{opt.label}</button>
          ))}
        </div>
        {selfExclude && (
          <button onClick={handleSelfExclude} disabled={saving}
            className="w-full py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700">
            Conferma Autoesclusione ({selfExclude === "permanent" ? "Permanente" : selfExclude + " giorni"})
          </button>
        )}
      </div>

      {/* Resources */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4">
        <h3 className="text-sm font-bold text-gray-900 mb-3">📞 Risorse di Aiuto</h3>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
            <span className="text-gray-600">Telefono Verde Gioco d'Azzardo</span>
            <span className="font-bold text-brand">800-558-822</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
            <span className="text-gray-600">GamCare</span>
            <span className="font-bold text-brand">gamcare.org.uk</span>
          </div>
          <div className="flex justify-between items-center py-1.5">
            <span className="text-gray-600">Giocatori Anonimi</span>
            <span className="font-bold text-brand">giocatoranonimi.org</span>
          </div>
        </div>
      </div>
    </div>
  );
}
