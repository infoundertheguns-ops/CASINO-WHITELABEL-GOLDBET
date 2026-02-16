"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";

// Same seed events as use-sportsbook hook
const EVENTS = [
  { id:"e1",league:"Serie A",home:"Inter",away:"Juventus",time:"LIVE 72'",live:true,minute:72,scoreH:2,scoreA:1,odds1:1.45,oddsX:4.50,odds2:6.00,oddsO:1.30,oddsU:3.40,oddsGG:1.55,oddsNG:2.30 },
  { id:"e2",league:"Serie A",home:"Milan",away:"Napoli",time:"20:45",live:false,odds1:2.10,oddsX:3.40,odds2:3.20,oddsO:1.85,oddsU:1.95,oddsGG:1.70,oddsNG:2.10 },
  { id:"e3",league:"Premier League",home:"Arsenal",away:"Liverpool",time:"21:00",live:false,odds1:2.30,oddsX:3.50,odds2:2.90,oddsO:1.75,oddsU:2.05,oddsGG:1.60,oddsNG:2.25 },
  { id:"e4",league:"La Liga",home:"Real Madrid",away:"Barcelona",time:"LIVE 34'",live:true,minute:34,scoreH:0,scoreA:0,odds1:2.60,oddsX:3.20,odds2:2.70,oddsO:2.10,oddsU:1.72,oddsGG:1.80,oddsNG:1.95 },
  { id:"e5",league:"Bundesliga",home:"Bayern",away:"Dortmund",time:"18:30",live:false,odds1:1.65,oddsX:4.00,odds2:4.80,oddsO:1.50,oddsU:2.50,oddsGG:1.65,oddsNG:2.15 },
  { id:"e6",league:"Ligue 1",home:"PSG",away:"Marseille",time:"21:00",live:false,odds1:1.35,oddsX:5.50,odds2:7.50,oddsO:1.55,oddsU:2.40,oddsGG:1.90,oddsNG:1.85 },
  { id:"e7",league:"Champions League",home:"Man City",away:"Inter",time:"Domani 21:00",live:false,odds1:1.80,oddsX:3.60,odds2:4.20,oddsO:1.80,oddsU:2.00,oddsGG:1.75,oddsNG:2.05 },
  { id:"e8",league:"Champions League",home:"Real Madrid",away:"Bayern",time:"Domani 21:00",live:false,odds1:2.20,oddsX:3.40,odds2:3.10,oddsO:1.70,oddsU:2.10,oddsGG:1.65,oddsNG:2.20 },
  { id:"e9",league:"Serie A",home:"Roma",away:"Lazio",time:"LIVE 55'",live:true,minute:55,scoreH:1,scoreA:1,odds1:2.80,oddsX:2.90,odds2:2.80,oddsO:1.90,oddsU:1.90,oddsGG:1.20,oddsNG:4.50 },
  { id:"e10",league:"Premier League",home:"Man United",away:"Chelsea",time:"15:00",live:false,odds1:2.50,oddsX:3.30,odds2:2.80,oddsO:1.85,oddsU:1.95,oddsGG:1.72,oddsNG:2.08 },
];

interface Selection { id: string; label: string; odds: number; marketType: string; selection: string; }
interface BetItem { eventId: string; match: string; marketName: string; selection: string; odds: number; }

export default function EventDetail() {
  const params = useParams();
  const router = useRouter();
  const { user, wallet, refreshWallet } = useAuth();
  const supabase = createClient();
  const [betslip, setBetslip] = useState<BetItem[]>([]);
  const [stake, setStake] = useState(10);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState("");

  const ev = EVENTS.find(e => e.id === params?.id);
  if (!ev) return (
    <div className="p-6 text-center">
      <p className="text-gray-400 mb-3">Evento non trovato</p>
      <button onClick={() => router.push("/sport")} className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-bold">← Sport</button>
    </div>
  );

  // Build all market groups from event odds
  const mkId = (suffix: string) => `${ev.id}-${suffix}`;
  const dc = (a: number, b: number) => +(1 / (1/a + 1/b)).toFixed(2);

  const marketGroups = [
    { name: "Risultato Finale (1X2)", markets: [
      { id: mkId("1x2-1"), label: "1", odds: ev.odds1, marketType: "1X2", selection: "1" },
      { id: mkId("1x2-x"), label: "X", odds: ev.oddsX, marketType: "1X2", selection: "X" },
      { id: mkId("1x2-2"), label: "2", odds: ev.odds2, marketType: "1X2", selection: "2" },
    ]},
    { name: "Doppia Chance", markets: [
      { id: mkId("dc-1x"), label: "1X", odds: dc(ev.odds1, ev.oddsX), marketType: "DC", selection: "1X" },
      { id: mkId("dc-x2"), label: "X2", odds: dc(ev.oddsX, ev.odds2), marketType: "DC", selection: "X2" },
      { id: mkId("dc-12"), label: "12", odds: dc(ev.odds1, ev.odds2), marketType: "DC", selection: "12" },
    ]},
    { name: "Over/Under 2.5", markets: [
      { id: mkId("ou25-o"), label: "Over 2.5", odds: ev.oddsO, marketType: "O/U 2.5", selection: "Over" },
      { id: mkId("ou25-u"), label: "Under 2.5", odds: ev.oddsU, marketType: "O/U 2.5", selection: "Under" },
    ]},
    { name: "Over/Under 1.5", markets: [
      { id: mkId("ou15-o"), label: "Over 1.5", odds: +(ev.oddsO * 0.65).toFixed(2), marketType: "O/U 1.5", selection: "Over" },
      { id: mkId("ou15-u"), label: "Under 1.5", odds: +(ev.oddsU * 1.8).toFixed(2), marketType: "O/U 1.5", selection: "Under" },
    ]},
    { name: "Over/Under 3.5", markets: [
      { id: mkId("ou35-o"), label: "Over 3.5", odds: +(ev.oddsO * 1.5).toFixed(2), marketType: "O/U 3.5", selection: "Over" },
      { id: mkId("ou35-u"), label: "Under 3.5", odds: +(ev.oddsU * 0.7).toFixed(2), marketType: "O/U 3.5", selection: "Under" },
    ]},
    { name: "Goal / No Goal", markets: [
      { id: mkId("gg"), label: "GG", odds: ev.oddsGG, marketType: "GG/NG", selection: "GG" },
      { id: mkId("ng"), label: "NG", odds: ev.oddsNG, marketType: "GG/NG", selection: "NG" },
    ]},
    { name: "Draw No Bet", markets: [
      { id: mkId("dnb-1"), label: ev.home, odds: +(ev.odds1 * 0.85).toFixed(2), marketType: "DNB", selection: "1" },
      { id: mkId("dnb-2"), label: ev.away, odds: +(ev.odds2 * 0.7).toFixed(2), marketType: "DNB", selection: "2" },
    ]},
    { name: "Primo Gol", markets: [
      { id: mkId("fg-1"), label: ev.home, odds: +(ev.odds1 * 1.1).toFixed(2), marketType: "FIRST_GOAL", selection: "1" },
      { id: mkId("fg-2"), label: ev.away, odds: +(ev.odds2 * 0.9).toFixed(2), marketType: "FIRST_GOAL", selection: "2" },
      { id: mkId("fg-no"), label: "Nessun Gol", odds: +(8 + Math.random() * 4).toFixed(2), marketType: "FIRST_GOAL", selection: "No" },
    ]},
    { name: "Risultato Esatto", markets:
      ["1-0","2-0","2-1","3-0","3-1","0-0","1-1","2-2","0-1","0-2","1-2","0-3"].map(s => ({
        id: mkId(`es-${s}`), label: s, odds: +(4 + Math.random() * 25).toFixed(2), marketType: "EXACT_SCORE", selection: s,
      })),
    },
    { name: "Handicap (-1)", markets: [
      { id: mkId("hc-1"), label: `${ev.home} (-1)`, odds: +(ev.odds1 * 1.8).toFixed(2), marketType: "HANDICAP", selection: "1" },
      { id: mkId("hc-x"), label: "X", odds: +(ev.oddsX * 1.2).toFixed(2), marketType: "HANDICAP", selection: "X" },
      { id: mkId("hc-2"), label: `${ev.away} (+1)`, odds: +(ev.odds2 * 0.5).toFixed(2), marketType: "HANDICAP", selection: "2" },
    ]},
  ];

  const isInSlip = (id: string) => betslip.some(b => b.selection === id || betslip.some(x => x.marketName === id));
  const isSelected = (mktId: string) => betslip.some(b => (b as any)._id === mktId);

  const toggle = (m: Selection) => {
    const exists = betslip.find(b => (b as any)._id === m.id);
    if (exists) {
      setBetslip(betslip.filter(b => (b as any)._id !== m.id));
    } else {
      // Remove same market type selections
      const filtered = betslip.filter(b => (b as any)._mkt !== m.marketType);
      filtered.push({ eventId: ev.id, match: `${ev.home} vs ${ev.away}`, marketName: m.marketType, selection: m.selection, odds: m.odds, _id: m.id, _mkt: m.marketType } as any);
      setBetslip(filtered);
    }
  };

  const totalOdds = betslip.reduce((t, b) => t * b.odds, 1);

  const placeBet = async () => {
    if (!user || !wallet || betslip.length === 0 || stake <= 0) return;
    if (wallet.balance < stake) { setMsg("❌ Saldo insufficiente"); return; }
    setPlacing(true); setMsg("");
    try {
      const betType = betslip.length === 1 ? "single" : "multi";
      const { data: bet, error } = await supabase.from("bets").insert({
        user_id: user.id, bet_type: betType, total_odds: +totalOdds.toFixed(4),
        stake, potential_payout: +(stake * totalOdds).toFixed(2), status: "open", currency: "USD",
      }).select("id").single();
      if (error || !bet) throw new Error(error?.message || "Insert failed");

      const legs = betslip.map(b => ({
        bet_id: bet.id, event_id: b.eventId, market_type: b.marketName,
        selection: b.selection, odds: b.odds, status: "open",
      }));
      await supabase.from("bet_selections").insert(legs);
      await supabase.from("wallets").update({ balance: wallet.balance - stake }).eq("user_id", user.id);
      await supabase.from("transactions").insert({
        user_id: user.id, type: "bet", amount: -stake, currency: "USD", status: "completed",
        description: `Scommessa: ${ev.home} vs ${ev.away}`,
      });
      setBetslip([]); setMsg("✅ Scommessa piazzata!"); refreshWallet();
      setTimeout(() => setMsg(""), 4000);
    } catch (err: any) { setMsg(`❌ ${err.message}`); }
    setPlacing(false);
  };

  const sel = (id: string) => betslip.some(b => (b as any)._id === id);

  return (
    <div className="p-4 lg:p-0">
      <button onClick={() => router.push("/sport")} className="text-xs text-gray-400 hover:text-brand mb-3 flex items-center gap-1">← Tutti gli eventi</button>

      <div className={cn("rounded-2xl p-6 mb-5", ev.live ? "bg-gradient-to-r from-red-600 to-red-500" : "bg-gradient-to-r from-gray-800 to-gray-700")}>
        {ev.live && <div className="absolute top-3 right-3 flex items-center gap-1.5"><span className="w-2 h-2 bg-white rounded-full animate-pulse" /><span className="text-white text-[10px] font-bold">{ev.minute}'</span></div>}
        <div className="text-[10px] text-white/60 mb-3">{ev.league}</div>
        <div className="flex items-center justify-center gap-6">
          <div className="text-lg font-black text-white">{ev.home}</div>
          {ev.live ? (
            <div className="text-center"><div className="text-3xl font-black text-white">{ev.scoreH} - {ev.scoreA}</div><div className="text-[10px] text-white/60">LIVE</div></div>
          ) : (
            <div className="text-center"><div className="text-sm font-bold text-white/60">VS</div><div className="text-[10px] text-white/40">{ev.time}</div></div>
          )}
          <div className="text-lg font-black text-white">{ev.away}</div>
        </div>
      </div>

      <div className="lg:flex lg:gap-5">
        <div className="flex-1">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Mercati ({marketGroups.length})</h2>
          <div className="space-y-3">
            {marketGroups.map((g, gi) => (
              <div key={gi} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200"><span className="text-xs font-bold text-gray-700">{g.name}</span></div>
                <div className={cn("p-3 gap-2", g.markets.length <= 3 ? "flex" : "grid grid-cols-3 lg:grid-cols-4")}>
                  {g.markets.map(m => (
                    <button key={m.id} onClick={() => toggle(m)}
                      className={cn("flex-1 py-2.5 px-2 rounded-lg text-center border-2 transition-all min-w-0",
                        sel(m.id) ? "border-brand bg-brand/10 ring-1 ring-brand" : "border-gray-200 hover:border-gray-300")}>
                      <div className="text-[10px] text-gray-500 truncate">{m.label}</div>
                      <div className={cn("text-sm font-bold font-mono", sel(m.id) ? "text-brand" : "text-gray-900")}>{m.odds}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:w-72 mt-5 lg:mt-0">
          <div className="bg-white rounded-xl border border-gray-200 p-4 lg:sticky lg:top-20">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-gray-900">🎫 Schedina</span>
              {betslip.length > 0 && <span className="bg-brand text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{betslip.length}</span>}
            </div>
            {betslip.length === 0 ? <p className="text-xs text-gray-400 text-center py-4">Clicca una quota</p> : (<>
              {betslip.map((b, i) => (
                <div key={i} className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0">
                  <div className="flex-1 min-w-0"><div className="text-[10px] text-gray-800 font-medium truncate">{b.match}</div><div className="text-[9px] text-gray-400">{b.marketName}: {b.selection}</div></div>
                  <div className="flex items-center gap-1.5"><span className="text-xs font-bold text-brand">{b.odds.toFixed(2)}</span><button onClick={() => toggle({ id: (b as any)._id, label: "", odds: b.odds, marketType: (b as any)._mkt, selection: b.selection })} className="text-gray-400 hover:text-red-400 text-xs">✕</button></div>
                </div>
              ))}
              {betslip.length > 1 && <div className="flex justify-between py-2 border-t border-gray-200 mt-1"><span className="text-[10px] text-gray-400">Multipla ({betslip.length})</span><span className="text-xs font-bold text-gray-900">{totalOdds.toFixed(2)}</span></div>}
              <div className="mt-3 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input type="number" value={stake} onChange={e => setStake(+e.target.value || 0)} className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand" /></div>
              <div className="flex gap-1 mt-1.5">{[5,10,25,50,100].map(v => <button key={v} onClick={() => setStake(v)} className="flex-1 py-1 rounded bg-gray-100 text-[10px] font-bold text-gray-500 hover:bg-gray-200">${v}</button>)}</div>
              <div className="flex justify-between items-center mt-3 mb-2"><span className="text-xs text-gray-400">Vincita</span><span className="text-lg font-black text-emerald-500 font-mono">${(stake * totalOdds).toFixed(2)}</span></div>
              {msg && <div className={cn("mb-2 px-3 py-1.5 rounded-lg text-xs text-center font-semibold", msg.startsWith("✅") ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")}>{msg}</div>}
              {!user && <p className="text-[10px] text-red-500 text-center mb-2">Accedi per scommettere</p>}
              <button onClick={placeBet} disabled={placing || !user || stake <= 0} className={cn("w-full py-2.5 rounded-xl text-white text-sm font-bold", placing || !user ? "bg-gray-400" : "bg-brand hover:bg-brand-dark")}>{placing ? "⏳..." : "Piazza Scommessa"}</button>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
