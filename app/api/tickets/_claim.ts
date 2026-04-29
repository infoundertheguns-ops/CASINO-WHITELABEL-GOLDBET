export interface ClaimRpcRow {
  ticket_id: string | null;
  amount_paid: number | null;
  already_claimed: boolean;
  not_payable: boolean;
}

export interface MappedResult {
  status: number;
  body: any;
}

export function mapClaimRpcResult(rows: ClaimRpcRow[]): MappedResult {
  if (!rows || rows.length === 0) {
    return { status: 500, body: { error: "RPC vuota" } };
  }
  const r = rows[0];
  if (r.already_claimed) {
    return { status: 409, body: { error: "Ticket già incassato" } };
  }
  if (r.not_payable) {
    return { status: 400, body: { error: "Ticket non pagabile (stato non consentito)" } };
  }
  if (!r.ticket_id) {
    return { status: 404, body: { error: "Ticket non trovato" } };
  }
  return { status: 200, body: { success: true, amount_paid: Number(r.amount_paid), ticket_id: r.ticket_id } };
}
