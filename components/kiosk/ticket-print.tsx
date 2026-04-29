"use client";

import { useRef } from "react";

interface TicketSelection {
  match: string;
  market: string;
  selection: string;
  odds: number;
}

interface TicketData {
  ticketCode: string;
  betType: string;
  selections: TicketSelection[];
  stake: number;
  totalOdds: number;
  potentialWin: number;
  printedAt: string;
  expiresAt: string;
}

// QR code as simple text-based barcode (real QR would use a library)
function BarcodeDisplay({ code }: { code: string }) {
  return (
    <div style={{ textAlign: "center", margin: "12px 0" }}>
      {/* Large ticket code for scanning */}
      <div style={{
        fontFamily: "monospace", fontSize: 28, fontWeight: 900,
        letterSpacing: 4, color: "#000", margin: "8px 0",
      }}>
        {code}
      </div>
      {/* Barcode-like visual */}
      <div style={{ display: "flex", justifyContent: "center", gap: 1, margin: "4px 0" }}>
        {code.replace("TK-", "").split("").map((char, i) => {
          const width = (char.charCodeAt(0) % 3) + 1;
          return (
            <div key={i} style={{
              width: width * 2, height: 40,
              background: i % 2 === 0 ? "#000" : "#fff",
              border: "1px solid #000",
            }} />
          );
        })}
      </div>
    </div>
  );
}

export function TicketPrint({ ticket, onClose }: { ticket: TicketData; onClose: () => void }) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open("", "_blank", "width=300,height=600");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Ticket ${ticket.ticketCode}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Courier New', monospace; width: 80mm; padding: 4mm; font-size: 11px; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .line { border-top: 1px dashed #000; margin: 6px 0; }
            .row { display: flex; justify-content: space-between; margin: 2px 0; }
            .big { font-size: 16px; font-weight: 900; letter-spacing: 2px; }
            .barcode { display: flex; justify-content: center; gap: 1px; margin: 6px 0; }
            .bar { height: 30px; background: #000; }
            .sel { margin: 4px 0; padding: 4px 0; border-bottom: 1px dotted #ccc; }
          </style>
        </head>
        <body>
          ${content.innerHTML}
          <script>window.onload = function() { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const dateStr = new Date(ticket.printedAt).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const expiryStr = new Date(ticket.expiresAt).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 24,
        width: 360, maxHeight: "90vh", overflow: "auto",
      }}>
        {/* Preview */}
        <div ref={printRef} style={{ color: "#000", fontSize: 12 }}>
          <div className="center" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>BETSSOLUTION</div>
            <div style={{ fontSize: 10, color: "#666" }}>Ricevuta Scommessa</div>
          </div>

          <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />

          <BarcodeDisplay code={ticket.ticketCode} />

          <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />

          <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>SELEZIONI:</div>
          {ticket.selections.map((s, i) => (
            <div key={i} style={{ margin: "4px 0", paddingBottom: 4, borderBottom: "1px dotted #ddd" }}>
              <div style={{ fontWeight: 700, fontSize: 11 }}>{s.match}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444" }}>
                <span>{s.market}: {s.selection}</span>
                <span style={{ fontWeight: 700 }}>{s.odds.toFixed(2)}</span>
              </div>
            </div>
          ))}

          <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", margin: "3px 0" }}>
            <span>Tipo:</span>
            <span style={{ fontWeight: 700 }}>{ticket.betType.toUpperCase()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", margin: "3px 0" }}>
            <span>Puntata:</span>
            <span style={{ fontWeight: 700 }}>€{ticket.stake.toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", margin: "3px 0" }}>
            <span>Quota:</span>
            <span style={{ fontWeight: 700 }}>{ticket.totalOdds.toFixed(2)}</span>
          </div>

          <div style={{ borderTop: "2px solid #000", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", margin: "3px 0", fontSize: 14 }}>
            <span style={{ fontWeight: 800 }}>VINCITA POT.:</span>
            <span style={{ fontWeight: 900, fontSize: 16 }}>€{ticket.potentialWin.toFixed(2)}</span>
          </div>

          <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />
          <div style={{ fontSize: 9, color: "#888", textAlign: "center" }}>
            <div>Data: {dateStr}</div>
            <div>Scadenza: {expiryStr}</div>
            <div style={{ marginTop: 4 }}>Conserva questo ticket per riscuotere la vincita</div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handlePrint} style={{
            flex: 1, padding: "12px", borderRadius: 8, border: "none",
            background: "#c41e2a", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
          }}>
            STAMPA TICKET
          </button>
          <button onClick={onClose} style={{
            padding: "12px 20px", borderRadius: 8, border: "1px solid #ddd",
            background: "#fff", color: "#666", fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
