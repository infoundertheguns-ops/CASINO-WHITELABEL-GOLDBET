"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TicketScanInput, ScanInputHandle } from "./components/ticket-scan-input";
import { TicketCard } from "./components/ticket-card";
import { PayModal } from "./components/pay-modal";
import { ReceiptTemplate, ReceiptData } from "./components/receipt-template";
import { ShiftSidebar } from "./components/shift-sidebar";
import { SearchDrawer } from "./components/search-drawer";
import { isValidTicketCode, normalizeTicketCode } from "./lib/ticket-code";
import { isPayable } from "./lib/status-map";

interface SessionInfo {
  adminUserId: string;
  role: string;
  username: string;
}

export default function AgentTicketsPage() {
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState<any>(null);
  const [selections, setSelections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const submittingRef = useRef<number>(0);

  const inputRef = useRef<ScanInputHandle>(null);
  const refocus = useCallback(() => setTimeout(() => inputRef.current?.focus(), 0), []);

  // Carica session una volta (per role super_admin + nome cassiere in receipt)
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s?.adminUserId) setSession(s); })
      .catch(() => {});
  }, []);

  const verifyCode = useCallback(async (target: string) => {
    if (!target.trim()) return;
    if (!isValidTicketCode(target.trim())) {
      setError("Formato codice non valido (TK-XXXXXX)");
      return;
    }
    // Debounce doppio submit (scanner che emette due ENTER)
    if (Date.now() - submittingRef.current < 300) return;
    submittingRef.current = Date.now();

    setLoading(true); setError(""); setTicket(null); setSelections([]);
    try {
      const res = await fetch(`/api/tickets?code=${encodeURIComponent(target.trim())}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Errore"); return; }
      setTicket(data.ticket);
      setSelections(data.selections || []);
    } catch (e: any) { setError(e?.message ?? "Errore di rete"); }
    finally { setLoading(false); refocus(); }
  }, [refocus]);

  const handleVerify = useCallback(() => verifyCode(code), [code, verifyCode]);

  const buildReceiptData = (
    t: any,
    sels: any[],
    amountPaid: number,
    isReprint: boolean,
  ): ReceiptData => ({
    ticket_code: t.ticket_code,
    bet_type: t.bet_type,
    stake: Number(t.stake) || 0,
    total_odds: Number(t.total_odds) || 0,
    amount_paid: amountPaid,
    selections: sels.map((s) => ({
      label: `${s.events?.home_team ?? ""} vs ${s.events?.away_team ?? ""}`,
      odds: Number(s.odds_at_placement) || 0,
    })),
    cashier_name: session?.username ?? "operatore",
    cashier_id: session?.adminUserId ?? "",
    timestamp: new Date().toLocaleString("it-IT"),
    is_reprint: isReprint,
  });

  const handlePayConfirm = useCallback(async () => {
    if (!ticket) return;
    setLoading(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_code: ticket.ticket_code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Errore pagamento"); return; }

      setReceiptData(buildReceiptData(ticket, selections, Number(data.amount_paid) || 0, false));
      setPayOpen(false);

      // Aspetta render template, poi stampa
      setTimeout(() => {
        window.print();
        setRefreshKey((k) => k + 1);
        verifyCode(ticket.ticket_code); // ricarica ticket (ora claimed)
      }, 100);
    } catch (e: any) { setError(e?.message ?? "Errore di rete"); }
    finally { setLoading(false); refocus(); }
  }, [ticket, selections, session, verifyCode, refocus]);

  const handleReprint = useCallback(async (tcode: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets?code=${encodeURIComponent(tcode)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Errore"); return; }
      // Log reprint server-side (best effort)
      await fetch("/api/tickets/reprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_code: tcode }),
      }).catch(() => {});
      const t = data.ticket;
      const amt = Number(t.win_amount ?? t.stake ?? 0);
      setReceiptData(buildReceiptData(t, data.selections ?? [], amt, true));
      setTimeout(() => window.print(), 100);
    } catch (e: any) { setError(e?.message ?? "Errore di rete"); }
    finally { setLoading(false); }
  }, [session]);

  const handleUnlockExpired = useCallback(async () => {
    if (!ticket) return;
    setLoading(true);
    try {
      const res = await fetch("/api/tickets/unlock-expired", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_code: ticket.ticket_code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Errore sblocco"); return; }
      verifyCode(ticket.ticket_code);
    } catch (e: any) { setError(e?.message ?? "Errore di rete"); }
    finally { setLoading(false); }
  }, [ticket, verifyCode]);

  const handleReset = useCallback(() => {
    setCode(""); setTicket(null); setError(""); setSelections([]);
    refocus();
  }, [refocus]);

  // Global keyboard shortcuts: F2 (sidebar), F3 (search), SPACE (pay)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); setSidebarOpen((o) => !o); }
      if (e.key === "F3") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === " " && ticket && isPayable(ticket.status) && !payOpen) {
        if ((document.activeElement as HTMLElement | null)?.tagName !== "INPUT") {
          e.preventDefault();
          setPayOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ticket, payOpen]);

  const amount = ticket
    ? (ticket.status === "void" ? Number(ticket.stake) : Number(ticket.win_amount ?? ticket.potential_win ?? 0))
    : 0;

  return (
    <>
      <div className="flex gap-4 print:hidden">
        <div className="flex-1 space-y-4 max-w-4xl">
          <h2 className="text-xl font-bold text-amber-400 m-0">Verifica & Incasso Ticket</h2>

          <TicketScanInput
            ref={inputRef}
            value={code}
            onChange={setCode}
            onSubmit={handleVerify}
            onReset={handleReset}
            loading={loading}
          />

          {error && (
            <div className="p-3 rounded bg-red-500/20 text-red-400 text-sm">{error}</div>
          )}

          {ticket && (
            <TicketCard
              ticket={ticket}
              selections={selections}
              onPay={() => setPayOpen(true)}
              onReprint={() => handleReprint(ticket.ticket_code)}
              onUnlockExpired={handleUnlockExpired}
              canUnlock={session?.role === "super_admin"}
            />
          )}

          <div className="text-xs text-slate-500">
            ENTER verifica · ESC reset · SPACE paga · F2 sidebar · F3 ricerca
          </div>
        </div>

        <ShiftSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
          onOpenSearch={() => setSearchOpen(true)}
          onSelect={(c) => { setCode(c); verifyCode(c); }}
          onReprint={handleReprint}
          refreshKey={refreshKey}
        />
      </div>

      <PayModal
        open={payOpen}
        amount={amount}
        ticketCode={ticket?.ticket_code ?? ""}
        loading={loading}
        onConfirm={handlePayConfirm}
        onCancel={() => { setPayOpen(false); refocus(); }}
      />

      <SearchDrawer
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(c) => { setCode(c); verifyCode(c); }}
      />

      <ReceiptTemplate data={receiptData} />
    </>
  );
}
