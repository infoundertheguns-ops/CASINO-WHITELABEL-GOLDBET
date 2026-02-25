"use client";

import { useAuth } from "@/lib/hooks/use-auth";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export default function AccountPage() {
  const { user, wallet, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/";
  };

  return (
    <div className="p-4 lg:p-0">
      <div className="lg:grid lg:grid-cols-3 lg:gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center text-2xl">
                👤
              </div>
              <div>
                <div className="font-bold text-gray-900 text-lg">{user?.username || "Guest"}</div>
                <div className="text-xs text-gray-400">{user?.email || ""}</div>
              </div>
            </div>

            <div className="space-y-0.5">
              {[
                ["Stato KYC", user?.kyc_status === "verified" ? "✅ Verificato" : "⚠️ Non verificato", user?.kyc_status === "verified" ? "text-emerald-600" : "text-orange-500"],
                ["Classe", user?.user_class || "new", "text-gray-800"],
                ["Saldo", `$${wallet?.balance?.toFixed(2) || "0.00"}`, "text-emerald-600 font-mono"],
                ["Membro dal", user?.created_at ? new Date(user.created_at).toLocaleDateString("it-IT") : "—", "text-gray-800"],
              ].map(([label, value, color], i) => (
                <div key={i} className="flex justify-between py-2.5 border-b border-gray-100 text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className={cn("font-semibold", color)}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Menu */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Account</span>
            </div>
            {[
              { icon: "📄", label: "Verifica Identità (KYC)", desc: "Carica documenti per verificare il tuo account" },
              { icon: "🔒", label: "Sicurezza & 2FA", desc: "Password, autenticazione a due fattori" },
              { icon: "📱", label: "Dispositivi", desc: "Gestisci i dispositivi collegati" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors">
                <span className="text-xl w-8 text-center">{item.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{item.label}</div>
                  <div className="text-[11px] text-gray-400">{item.desc}</div>
                </div>
                <span className="text-gray-300">›</span>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Attività</span>
            </div>
            {[
              { icon: "📊", label: "Le Mie Scommesse", desc: "Storico scommesse e risultati" },
              { icon: "🎰", label: "Cronologia Casino", desc: "Sessioni, round e vincite" },
              { icon: "🎁", label: "I Miei Bonus", desc: "Bonus attivi, wagering e free spins" },
              { icon: "💳", label: "Transazioni", desc: "Depositi, prelievi e movimenti" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors">
                <span className="text-xl w-8 text-center">{item.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{item.label}</div>
                  <div className="text-[11px] text-gray-400">{item.desc}</div>
                </div>
                <span className="text-gray-300">›</span>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Supporto</span>
            </div>
            {[
              { icon: "⚖️", label: "Gioco Responsabile", desc: "Limiti deposito, auto-esclusione, timeout" },
              { icon: "📞", label: "Supporto", desc: "Contattaci via chat o email" },
              { icon: "📝", label: "Termini & Condizioni", desc: "Regolamento e condizioni d'uso" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors">
                <span className="text-xl w-8 text-center">{item.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{item.label}</div>
                  <div className="text-[11px] text-gray-400">{item.desc}</div>
                </div>
                <span className="text-gray-300">›</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleSignOut}
            className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-500 font-bold text-sm hover:bg-red-100 transition-colors"
          >
            Esci dall'account
          </button>
        </div>
      </div>
    </div>
  );
}
