"use client";

import { useState } from "react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useWallet } from "@/lib/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tab = "overview" | "deposita" | "preleva" | "transazioni";

export default function WalletPage() {
  const { user } = useAuth();
  const { wallet, transactions, addresses, loading, generateAddress, requestWithdrawal } = useWallet();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [generatingCoin, setGeneratingCoin] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  // Withdrawal form
  const [wCoin, setWCoin] = useState("USDT_TRC");
  const [wAmount, setWAmount] = useState("");
  const [wAddress, setWAddress] = useState("");
  const [wError, setWError] = useState("");
  const [wLoading, setWLoading] = useState(false);
  const [wSuccess, setWSuccess] = useState(false);

  const balance = wallet?.balance ?? 0;
  const bonus = wallet?.bonus_balance ?? 0;
  const locked = wallet?.locked_balance ?? 0;

  const handleGenerate = async (coin: string) => {
    setGeneratingCoin(coin);
    await generateAddress(coin);
    setGeneratingCoin(null);
  };

  const handleCopy = (address: string, coin: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(coin);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const handleWithdraw = async () => {
    setWError("");
    setWSuccess(false);
    if (!wAmount || parseFloat(wAmount) <= 0) { setWError("Inserisci un importo valido"); return; }
    if (!wAddress || wAddress.length < 10) { setWError("Inserisci un indirizzo valido"); return; }
    setWLoading(true);
    const result = await requestWithdrawal(wCoin, parseFloat(wAmount), wAddress);
    setWLoading(false);
    if (result.success) {
      setWSuccess(true);
      setWAmount("");
      setWAddress("");
    } else {
      setWError(result.error || "Errore nel prelievo");
    }
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Saldo", icon: "💰" },
    { id: "deposita", label: "Deposita", icon: "↓" },
    { id: "preleva", label: "Preleva", icon: "↑" },
    { id: "transazioni", label: "Cronologia", icon: "📋" },
  ];

  return (
    <div className="p-4 lg:p-0">
      {/* Balance Card */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-5 lg:p-8 mb-4 text-white">
        <div className="text-xs text-gray-400 mb-1">Saldo Totale</div>
        <div className="text-3xl lg:text-4xl font-black font-mono tracking-tight mb-1">
          ${balance.toFixed(2)}
        </div>
        <div className="flex gap-4 text-xs text-gray-400 mb-5">
          <span>Bonus: <span className="text-purple-400 font-mono">${bonus.toFixed(2)}</span></span>
          <span>Bloccato: <span className="text-orange-400 font-mono">${locked.toFixed(2)}</span></span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => setActiveTab("deposita")}
            className="py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 transition-colors"
          >
            ↓ Deposita
          </button>
          <button
            onClick={() => setActiveTab("preleva")}
            className="py-2.5 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-bold hover:bg-white/20 transition-colors"
          >
            ↑ Preleva
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 py-2 rounded-lg text-xs font-semibold transition-all",
              activeTab === tab.id
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <span className="mr-1">{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ OVERVIEW ═══ */}
      {activeTab === "overview" && (
        <div>
          <div className="grid grid-cols-3 gap-2 mb-6">
            {[
              { label: "Disponibile", value: balance, color: "text-emerald-500" },
              { label: "Bonus", value: bonus, color: "text-purple-500" },
              { label: "Bloccato", value: locked, color: "text-orange-500" },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <div className="text-[10px] text-gray-400 font-semibold">{item.label}</div>
                <div className={cn("text-sm font-bold font-mono", item.color)}>${item.value.toFixed(2)}</div>
              </div>
            ))}
          </div>

          {/* Quick deposit */}
          <div className="text-sm font-bold text-gray-900 mb-3">Deposito rapido</div>
          <div className="space-y-2">
            {addresses.map((addr) => (
              <div key={addr.coin} className="flex items-center justify-between py-3 px-4 bg-white rounded-xl border border-gray-200">
                <div className="flex items-center gap-3">
                  <span className="text-xl" style={{ color: addr.color }}>{addr.icon}</span>
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{addr.coin.replace("_TRC", "")}</div>
                    <div className="text-[10px] text-gray-400">{addr.network}</div>
                  </div>
                </div>
                {addr.address ? (
                  <button
                    onClick={() => handleCopy(addr.address!, addr.coin)}
                    className="text-xs text-brand font-semibold px-3 py-1 rounded-lg bg-brand/5 hover:bg-brand/10 transition-colors"
                  >
                    {copiedAddress === addr.coin ? "✓ Copiato!" : "Copia indirizzo"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleGenerate(addr.coin)}
                    disabled={generatingCoin === addr.coin}
                    className="text-xs text-brand font-semibold"
                  >
                    {generatingCoin === addr.coin ? "⏳ Generando..." : "Genera →"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ DEPOSITA ═══ */}
      {activeTab === "deposita" && (
        <div>
          <div className="text-sm font-bold text-gray-900 mb-1">Deposita Crypto</div>
          <p className="text-xs text-gray-500 mb-4">Genera un indirizzo, invia crypto, il saldo si aggiorna automaticamente.</p>

          <div className="space-y-3">
            {addresses.map((addr) => (
              <div key={addr.coin} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl" style={{ color: addr.color }}>{addr.icon}</span>
                  <div>
                    <div className="text-sm font-bold text-gray-800">{addr.coin.replace("_TRC", " (TRC-20)")}</div>
                    <div className="text-[10px] text-gray-400">{addr.network}</div>
                  </div>
                </div>

                {addr.address ? (
                  <div>
                    <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between mb-2">
                      <code className="text-xs text-gray-600 font-mono break-all">{addr.address}</code>
                    </div>
                    <button
                      onClick={() => handleCopy(addr.address!, addr.coin)}
                      className="w-full py-2 rounded-lg bg-brand/10 text-brand text-xs font-bold hover:bg-brand/20 transition-colors"
                    >
                      {copiedAddress === addr.coin ? "✓ Copiato negli appunti!" : "📋 Copia indirizzo"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleGenerate(addr.coin)}
                    disabled={generatingCoin === addr.coin}
                    className="w-full py-2.5 rounded-lg bg-brand text-white text-xs font-bold hover:bg-brand-dark transition-colors disabled:opacity-50"
                  >
                    {generatingCoin === addr.coin ? "⏳ Generando indirizzo..." : "Genera indirizzo deposito"}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-xl">
            <p className="text-xs text-yellow-700">
              ⚠️ Invia solo la criptovaluta corretta alla rete corretta. Invii errati possono causare la perdita dei fondi.
            </p>
          </div>
        </div>
      )}

      {/* ═══ PRELEVA ═══ */}
      {activeTab === "preleva" && (
        <div>
          <div className="text-sm font-bold text-gray-900 mb-1">Preleva Crypto</div>
          <p className="text-xs text-gray-500 mb-4">Saldo disponibile: <span className="font-mono font-bold text-emerald-600">${balance.toFixed(2)}</span></p>

          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
            {/* Coin selector */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Criptovaluta</label>
              <div className="grid grid-cols-4 gap-2">
                {COINS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setWCoin(c.id)}
                    className={cn(
                      "py-2 rounded-lg text-center text-xs font-bold border transition-all",
                      wCoin === c.id
                        ? "border-brand bg-brand/5 text-brand"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    )}
                  >
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Importo (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  value={wAmount}
                  onChange={(e) => setWAmount(e.target.value)}
                  placeholder="0.00"
                  className="input-player pl-7 font-mono"
                />
              </div>
              <div className="flex gap-2 mt-1.5">
                {[25, 50, 100].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setWAmount((balance * pct / 100).toFixed(2))}
                    className="text-[10px] font-bold text-brand bg-brand/5 px-2 py-0.5 rounded hover:bg-brand/10"
                  >
                    {pct}%
                  </button>
                ))}
                <button
                  onClick={() => setWAmount(balance.toFixed(2))}
                  className="text-[10px] font-bold text-brand bg-brand/5 px-2 py-0.5 rounded hover:bg-brand/10"
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Indirizzo destinazione</label>
              <input
                type="text"
                value={wAddress}
                onChange={(e) => setWAddress(e.target.value)}
                placeholder="Incolla l'indirizzo del tuo wallet..."
                className="input-player font-mono text-xs"
              />
            </div>

            {wError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600">{wError}</div>
            )}
            {wSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-600">
                ✅ Richiesta di prelievo inviata! Sarà processata entro 24h.
              </div>
            )}

            <Button
              variant="brand"
              fullWidth
              size="lg"
              loading={wLoading}
              onClick={handleWithdraw}
            >
              Richiedi Prelievo
            </Button>
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-xs text-blue-700">
              ℹ️ I prelievi vengono verificati manualmente. Fee di rete a carico dell'utente.
              Minimo prelievo: $20. Massimo: $10,000/giorno.
            </p>
          </div>
        </div>
      )}

      {/* ═══ TRANSAZIONI ═══ */}
      {activeTab === "transazioni" && (
        <div>
          <div className="text-sm font-bold text-gray-900 mb-3">Cronologia Transazioni</div>
          {transactions.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-3xl block mb-2">📋</span>
              <p className="text-sm text-gray-400">Nessuna transazione ancora</p>
              <button
                onClick={() => setActiveTab("deposita")}
                className="mt-3 text-xs text-brand font-semibold hover:underline"
              >
                Effettua il tuo primo deposito →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-3 px-4 bg-white rounded-xl border border-gray-200">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                      tx.type === "deposit" || tx.type === "win" ? "bg-emerald-50 text-emerald-500" :
                      tx.type === "withdrawal" || tx.type === "bet" || tx.type === "fee" ? "bg-red-50 text-red-500" :
                      "bg-purple-50 text-purple-500"
                    )}>
                      {tx.type === "deposit" ? "↓" : tx.type === "withdrawal" ? "↑" :
                       tx.type === "bet" ? "🎯" : tx.type === "win" ? "🏆" :
                       tx.type === "bonus" ? "🎁" : "💸"}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-gray-800 capitalize">{tx.type === "deposit" ? "Deposito" : tx.type === "withdrawal" ? "Prelievo" : tx.type === "bet" ? "Scommessa" : tx.type === "win" ? "Vincita" : tx.type === "bonus" ? "Bonus" : "Fee"}</div>
                      <div className="text-[10px] text-gray-400">
                        {new Date(tx.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "text-sm font-bold font-mono",
                      tx.type === "deposit" || tx.type === "win" || tx.type === "bonus" ? "text-emerald-500" : "text-red-500"
                    )}>
                      {tx.type === "deposit" || tx.type === "win" || tx.type === "bonus" ? "+" : "-"}${Math.abs(tx.amount).toFixed(2)}
                    </div>
                    <div className={cn(
                      "text-[9px] font-bold",
                      tx.status === "completed" || tx.status === "credited" ? "text-emerald-400" :
                      tx.status === "pending" ? "text-orange-400" : "text-gray-400"
                    )}>
                      {tx.status === "completed" || tx.status === "credited" ? "✓ Completato" :
                       tx.status === "pending" ? "⏳ In attesa" : tx.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const COINS = [
  { id: "BTC", icon: "₿", label: "BTC" },
  { id: "ETH", icon: "Ξ", label: "ETH" },
  { id: "USDT_TRC", icon: "₮", label: "USDT" },
  { id: "SOL", icon: "◎", label: "SOL" },
];
