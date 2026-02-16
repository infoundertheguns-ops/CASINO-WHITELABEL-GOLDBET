"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";

const COINS = [
  { id: "btc", name: "Bitcoin", symbol: "BTC", icon: "₿", color: "text-orange-500", network: "Bitcoin" },
  { id: "eth", name: "Ethereum", symbol: "ETH", icon: "Ξ", color: "text-blue-500", network: "ERC-20" },
  { id: "usdt", name: "Tether", symbol: "USDT", icon: "₮", color: "text-emerald-500", network: "TRC-20" },
  { id: "sol", name: "Solana", symbol: "SOL", icon: "◎", color: "text-purple-500", network: "Solana" },
];

function QRCode({ value, size = 160 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    c.width = size; c.height = size;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    const grid = 25, cell = size / grid;
    let hash = 0;
    for (let i = 0; i < value.length; i++) { hash = ((hash << 5) - hash) + value.charCodeAt(i); hash |= 0; }
    const drawMarker = (x: number, y: number) => {
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++)
        if (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4))
          ctx.fillRect((x + i) * cell, (y + j) * cell, cell, cell);
    };
    drawMarker(0, 0); drawMarker(grid - 7, 0); drawMarker(0, grid - 7);
    for (let i = 8; i < grid - 8; i++) for (let j = 8; j < grid - 8; j++) {
      if ((hash * (i * 31 + j * 17) & 0xFFFF) % 3 !== 0) ctx.fillRect(i * cell, j * cell, cell, cell);
    }
    for (let i = 8; i < grid - 8; i++) if (i % 2 === 0) { ctx.fillRect(6 * cell, i * cell, cell, cell); ctx.fillRect(i * cell, 6 * cell, cell, cell); }
  }, [value, size]);
  return <canvas ref={ref} className="rounded-lg border border-gray-200" />;
}

export default function WalletPage() {
  const { user, wallet, refreshWallet } = useAuth();
  const supabase = createClient();
  const [tab, setTab] = useState<"saldo"|"deposita"|"preleva"|"cronologia">("saldo");
  const [coin, setCoin] = useState(COINS[2]);
  const [address, setAddress] = useState("");
  const [generating, setGenerating] = useState(false);
  const [wdAmount, setWdAmount] = useState("");
  const [wdAddress, setWdAddress] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [wdResult, setWdResult] = useState<{type:"success"|"error";msg:string}|null>(null);
  const [txs, setTxs] = useState<any[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [code2FA, setCode2FA] = useState("");
  const [err2FA, setErr2FA] = useState("");
  const [depStatus, setDepStatus] = useState<string|null>(null);
  const [confirms, setConfirms] = useState(0);

  useEffect(() => { if (user) loadTx(); }, [user]);

  const loadTx = async () => {
    if (!user) return;
    setLoadingTx(true);
    const { data } = await supabase.from("transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    setTxs(data || []);
    setLoadingTx(false);
  };

  const genAddress = () => {
    setGenerating(true);
    const addrs: Record<string,string> = {
      btc: "bc1q" + Math.random().toString(36).slice(2, 34),
      eth: "0x" + Array.from({length:40},()=>Math.floor(Math.random()*16).toString(16)).join(""),
      usdt: "T" + Math.random().toString(36).slice(2, 34).toUpperCase(),
      sol: Math.random().toString(36).slice(2, 34) + Math.random().toString(36).slice(2, 12),
    };
    setTimeout(() => { setAddress(addrs[coin.id]); setGenerating(false); startMonitor(); }, 800);
  };

  const startMonitor = () => {
    setDepStatus("waiting"); setConfirms(0);
    setTimeout(() => setDepStatus("detecting"), 5000);
    setTimeout(() => { setDepStatus("confirming"); setConfirms(1); }, 8000);
    setTimeout(() => setConfirms(2), 11000);
    setTimeout(() => { setConfirms(3); setDepStatus("confirmed"); }, 14000);
  };

  const handleWdClick = () => {
    const amt = parseFloat(wdAmount);
    if (!user || !wallet) return;
    if (!amt || amt < 10) { setWdResult({type:"error",msg:"Minimo prelievo: $10"}); return; }
    if (amt > wallet.balance) { setWdResult({type:"error",msg:"Saldo insufficiente"}); return; }
    if (!wdAddress || wdAddress.length < 10) { setWdResult({type:"error",msg:"Indirizzo non valido"}); return; }
    setWdResult(null); setShow2FA(true);
  };

  const verify2FA = () => {
    if (code2FA.length === 6) { setShow2FA(false); setCode2FA(""); setErr2FA(""); executeWd(); }
    else setErr2FA("Inserisci 6 cifre");
  };

  const executeWd = async () => {
    if (!user || !wallet) return;
    const amt = parseFloat(wdAmount);
    setWithdrawing(true);
    try {
      await supabase.from("crypto_withdrawals").insert({ user_id: user.id, coin: coin.symbol, network: coin.network, amount_crypto: amt, amount_usdt: amt, to_address: wdAddress, status: "pending" });
      await supabase.from("wallets").update({ balance: wallet.balance - amt }).eq("user_id", user.id);
      await supabase.from("transactions").insert({ user_id: user.id, type: "withdrawal", amount: -amt, status: "pending", description: `Prelievo ${coin.symbol}` });
      setWdResult({type:"success",msg:`Prelievo di $${amt.toFixed(2)} richiesto!`});
      setWdAmount(""); setWdAddress(""); refreshWallet(); loadTx();
    } catch { setWdResult({type:"error",msg:"Errore"}); }
    setWithdrawing(false);
  };

  const bal = wallet?.balance || 0, bon = wallet?.bonus_balance || 0, lck = wallet?.locked_balance || 0;

  return (
    <div className="p-4 lg:p-0">
      <div className="rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 p-6 mb-5">
        <div className="text-xs text-gray-400 mb-1">Saldo Totale</div>
        <div className="text-3xl font-black text-white font-mono mb-1">${bal.toFixed(2)}</div>
        <div className="flex gap-3 text-[10px] mb-4">
          <span className="text-purple-400">Bonus: <b>${bon.toFixed(2)}</b></span>
          <span className="text-orange-400">Bloccato: <b>${lck.toFixed(2)}</b></span>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setTab("deposita")} className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold">↓ Deposita</button>
          <button onClick={()=>setTab("preleva")} className="flex-1 py-2.5 rounded-xl bg-white/10 text-white text-sm font-bold">↑ Preleva</button>
        </div>
      </div>

      <div className="flex border-b border-gray-200 mb-5">
        {([{id:"saldo",l:"💰 Saldo"},{id:"deposita",l:"↓ Deposita"},{id:"preleva",l:"↑ Preleva"},{id:"cronologia",l:"📋 Cronologia"}] as const).map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} className={cn("px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px",tab===t.id?"border-brand text-brand":"border-transparent text-gray-400")}>{t.l}</button>
        ))}
      </div>

      {tab==="saldo"&&<div>
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[{l:"Disponibile",v:bal,c:"text-emerald-500"},{l:"Bonus",v:bon,c:"text-purple-500"},{l:"Bloccato",v:lck,c:"text-orange-500"}].map((b,i)=>(
            <div key={i} className="bg-white rounded-xl border p-4 text-center"><div className="text-[10px] text-gray-400">{b.l}</div><div className={cn("text-lg font-black font-mono",b.c)}>${b.v.toFixed(2)}</div></div>
          ))}
        </div>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Deposito rapido</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {COINS.map(c=>(<button key={c.id} onClick={()=>{setCoin(c);setTab("deposita");setAddress("");}} className="flex items-center gap-2 p-3 rounded-xl border bg-white hover:border-brand"><span className={cn("text-lg",c.color)}>{c.icon}</span><div className="text-left"><div className="text-xs font-bold">{c.symbol}</div><div className="text-[9px] text-gray-400">{c.network}</div></div></button>))}
        </div>
      </div>}

      {tab==="deposita"&&<div>
        <div className="flex gap-2 mb-4">{COINS.map(c=>(<button key={c.id} onClick={()=>{setCoin(c);setAddress("");setDepStatus(null);}} className={cn("flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border",coin.id===c.id?"border-brand bg-brand/5 text-brand":"border-gray-200 text-gray-600")}><span className={c.color}>{c.icon}</span> {c.symbol}</button>))}</div>
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-1">Deposita {coin.name}</h3>
          <p className="text-[10px] text-gray-400 mb-4">Rete: {coin.network} · Conferme: 3</p>
          {address?(<div>
            <div className="flex flex-col items-center mb-4"><QRCode value={address} size={180} /><p className="text-[9px] text-gray-400 mt-2">Scansiona il QR code</p></div>
            <div className="bg-gray-50 rounded-lg p-4 mb-3"><div className="text-[9px] text-gray-400 mb-1">Indirizzo {coin.symbol}:</div><div className="text-xs font-mono text-gray-800 break-all select-all">{address}</div></div>
            <button onClick={()=>navigator.clipboard.writeText(address)} className="w-full py-2.5 rounded-xl bg-brand text-white text-sm font-bold">📋 Copia Indirizzo</button>
            {depStatus&&<div className="mt-4 p-3 rounded-lg border bg-gray-50">
              <div className="text-[10px] text-gray-500 font-semibold mb-2">📡 Monitor Deposito</div>
              <div className="flex items-center gap-2">
                {depStatus==="waiting"&&<><span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"/><span className="text-xs text-yellow-600">In attesa...</span></>}
                {depStatus==="detecting"&&<><span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"/><span className="text-xs text-blue-600">Transazione rilevata!</span></>}
                {depStatus==="confirming"&&<><span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"/><span className="text-xs text-orange-600">Conferme: {confirms}/3</span><div className="flex-1 bg-gray-200 rounded-full h-1.5 ml-2"><div className="bg-orange-400 h-1.5 rounded-full transition-all" style={{width:`${(confirms/3)*100}%`}}/></div></>}
                {depStatus==="confirmed"&&<><span className="w-2 h-2 rounded-full bg-emerald-400"/><span className="text-xs text-emerald-600 font-semibold">✓ Deposito confermato!</span></>}
              </div>
            </div>}
          </div>):(
            <button onClick={genAddress} disabled={generating} className="w-full py-3 rounded-xl bg-brand text-white text-sm font-bold">{generating?"⏳ Generando...":"Genera Indirizzo "+coin.symbol}</button>
          )}
          <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200"><p className="text-[10px] text-yellow-700">⚠️ Invia solo {coin.name} ({coin.network}) a questo indirizzo.</p></div>
        </div>
      </div>}

      {tab==="preleva"&&<div>
        <div className="flex gap-2 mb-4">{COINS.map(c=>(<button key={c.id} onClick={()=>setCoin(c)} className={cn("flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border",coin.id===c.id?"border-brand bg-brand/5 text-brand":"border-gray-200 text-gray-600")}><span className={c.color}>{c.icon}</span> {c.symbol}</button>))}</div>
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Preleva {coin.name}</h3>
          <div className="mb-3"><label className="text-[10px] text-gray-400 font-semibold block mb-1">Importo ($)</label>
            <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span><input type="number" value={wdAmount} onChange={e=>setWdAmount(e.target.value)} placeholder="0.00" className="w-full pl-7 pr-3 py-2.5 rounded-lg border text-sm font-mono focus:outline-none focus:border-brand"/></div>
            <div className="flex gap-1.5 mt-1.5">{[25,50,75,100].map(p=>(<button key={p} onClick={()=>setWdAmount((bal*p/100).toFixed(2))} className="flex-1 py-1 rounded bg-gray-100 text-[10px] font-bold text-gray-500">{p}%</button>))}</div>
          </div>
          <div className="mb-4"><label className="text-[10px] text-gray-400 font-semibold block mb-1">Indirizzo {coin.symbol}</label><input type="text" value={wdAddress} onChange={e=>setWdAddress(e.target.value)} placeholder={`Indirizzo ${coin.symbol}...`} className="w-full px-3 py-2.5 rounded-lg border text-sm font-mono focus:outline-none focus:border-brand"/></div>
          {wdResult&&<div className={cn("mb-3 px-3 py-2 rounded-lg text-xs text-center font-semibold",wdResult.type==="success"?"bg-emerald-50 text-emerald-600":"bg-red-50 text-red-600")}>{wdResult.msg}</div>}
          <button onClick={handleWdClick} disabled={withdrawing} className={cn("w-full py-3 rounded-xl text-white text-sm font-bold",withdrawing?"bg-gray-400":"bg-brand hover:bg-brand-dark")}>{withdrawing?"⏳...":"🔐 Richiedi Prelievo (2FA)"}</button>
          <div className="mt-3 text-[10px] text-gray-400 text-center">Min: $10 · Fee: 0% · Tempo: 1-24h</div>
        </div>
      </div>}

      {tab==="cronologia"&&<div className="bg-white rounded-xl border overflow-hidden">
        {loadingTx?<div className="p-8 text-center text-gray-400">Caricamento...</div>:
        txs.length===0?<div className="p-8 text-center"><span className="text-3xl block mb-2">📋</span><p className="text-sm text-gray-400">Nessuna transazione</p></div>:(
          <table className="w-full text-xs"><thead><tr className="text-gray-400 border-b bg-gray-50"><th className="text-left px-4 py-2.5">Tipo</th><th className="text-left px-4 py-2.5">Descrizione</th><th className="text-right px-4 py-2.5">Importo</th><th className="text-center px-4 py-2.5">Stato</th><th className="text-right px-4 py-2.5">Data</th></tr></thead>
          <tbody>{txs.map(tx=>(
            <tr key={tx.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-2.5"><span className={cn("text-[9px] font-bold px-2 py-0.5 rounded capitalize",tx.type==="deposit"?"bg-emerald-50 text-emerald-600":tx.type==="withdrawal"?"bg-red-50 text-red-500":tx.type==="bet"?"bg-orange-50 text-orange-500":"bg-blue-50 text-blue-500")}>{tx.type}</span></td>
              <td className="px-4 py-2.5 text-gray-600 truncate max-w-[200px]">{tx.description||"—"}</td>
              <td className={cn("px-4 py-2.5 text-right font-mono font-bold",tx.amount>=0?"text-emerald-500":"text-red-500")}>{tx.amount>=0?"+":""}${Math.abs(tx.amount).toFixed(2)}</td>
              <td className="px-4 py-2.5 text-center"><span className={cn("text-[9px] font-bold",tx.status==="completed"?"text-emerald-500":"text-yellow-500")}>{tx.status?.toUpperCase()}</span></td>
              <td className="px-4 py-2.5 text-right text-gray-400">{new Date(tx.created_at).toLocaleString("it-IT",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</td>
            </tr>
          ))}</tbody></table>
        )}
      </div>}

      {show2FA&&<div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={()=>setShow2FA(false)}>
        <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
          <div className="text-center mb-4"><span className="text-4xl block mb-2">🔐</span><h3 className="text-lg font-bold">Verifica 2FA</h3><p className="text-xs text-gray-400 mt-1">Inserisci codice 6 cifre</p></div>
          <input type="text" maxLength={6} value={code2FA} onChange={e=>setCode2FA(e.target.value.replace(/\D/g,""))} placeholder="000000" className="w-full text-center text-2xl font-bold tracking-[0.5em] py-3 rounded-lg border-2 focus:border-brand focus:outline-none mb-3"/>
          {err2FA&&<p className="text-xs text-red-500 text-center mb-3">{err2FA}</p>}
          <button onClick={verify2FA} className="w-full py-2.5 rounded-xl bg-brand text-white text-sm font-bold">Verifica e Preleva</button>
          <p className="text-[9px] text-gray-400 text-center mt-2">Demo: qualsiasi 6 cifre</p>
        </div>
      </div>}
    </div>
  );
}
