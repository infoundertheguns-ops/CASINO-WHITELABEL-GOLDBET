"use client";
import { forwardRef } from "react";

export interface ReceiptData {
  ticket_code: string;
  bet_type: string;
  stake: number;
  total_odds: number;
  amount_paid: number;
  selections: Array<{ label: string; odds: number }>;
  cashier_name: string;
  cashier_id: string;
  timestamp: string;
  is_reprint?: boolean;
}

export const ReceiptTemplate = forwardRef<HTMLDivElement, { data: ReceiptData | null }>(
  function ReceiptTemplate({ data }, ref) {
    if (!data) return null;
    const shown = data.selections.slice(0, 3);
    const rest = data.selections.length - shown.length;

    return (
      <div
        id="receipt-area"
        ref={ref}
        className="hidden print:block font-mono text-black bg-white"
        style={{ width: "80mm", padding: "4mm 2mm", fontSize: "12px", lineHeight: 1.25 }}
      >
        <style>{`
          @media print {
            @page { size: 80mm auto; margin: 0; }
            body * { visibility: hidden !important; }
            #receipt-area, #receipt-area * { visibility: visible !important; }
            #receipt-area { position: absolute; left: 0; top: 0; display: block !important; }
          }
        `}</style>
        <div style={{ textAlign: "center", fontWeight: 700 }}>BETSSOLUTION</div>
        <div style={{ textAlign: "center" }}>VIA ROMA 12, ROMA</div>
        <div>--------------------------------</div>
        <div style={{ textAlign: "center", fontWeight: 700 }}>
          {data.is_reprint ? "COPIA - RICEVUTA PAGAMENTO" : "RICEVUTA PAGAMENTO"}
        </div>
        <div>{data.timestamp}</div>
        <div>Cod: {data.ticket_code}</div>
        <div>--------------------------------</div>
        {shown.map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{s.label.slice(0, 22)}</span>
            <span>{s.odds.toFixed(2)}</span>
          </div>
        ))}
        {rest > 0 && <div>+ {rest} selezion{rest === 1 ? "e" : "i"}</div>}
        <div>--------------------------------</div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Stake</span><span>EUR {data.stake.toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Quota</span><span>x {data.total_odds.toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
          <span>PAGATO</span><span>EUR {data.amount_paid.toFixed(2)}</span>
        </div>
        <div>--------------------------------</div>
        <div>Cassiere: {data.cashier_name}</div>
        <div>ID: {data.cashier_id.slice(0, 8)}</div>
        <div>--------------------------------</div>
        <div style={{ textAlign: "center" }}>GRAZIE E BUONA FORTUNA</div>
      </div>
    );
  }
);
