export type TicketStatus = "open" | "won" | "lost" | "void" | "claimed" | "expired";
export type Tone = "info" | "success" | "danger" | "warning" | "violet" | "neutral";

export interface StatusVisual {
  label: string;
  tone: Tone;
  banner: string;
}

const MAP: Record<TicketStatus, StatusVisual> = {
  open:    { label: "IN CORSO", tone: "info",    banner: "Evento ancora in corso — attendere il risultato" },
  won:     { label: "VINTA",    tone: "success", banner: "Ticket vincente — pronto al pagamento" },
  lost:    { label: "PERSA",    tone: "danger",  banner: "Scommessa persa — nessun pagamento" },
  void:    { label: "VOID",     tone: "warning", banner: "Rimborso dello stake al cliente" },
  claimed: { label: "INCASSATA",tone: "violet",  banner: "Ticket già incassato" },
  expired: { label: "SCADUTA",  tone: "neutral", banner: "Ticket scaduto (oltre 30gg) — sblocco manuale richiesto" },
};

export function getStatusVisual(status: string): StatusVisual {
  return MAP[status as TicketStatus] ?? { label: status.toUpperCase(), tone: "neutral", banner: "" };
}

export function isPayable(status: string): boolean {
  return status === "won" || status === "void";
}
