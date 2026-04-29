const ALLOWED = /^TK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizeTicketCode(raw: string): string {
  // Scanner on US keyboard layout emits "'" where Italian layout has "-".
  // Accept both and any unicode dash variant after TK.
  return raw
    .replace(/\s+/g, "")
    .replace(/^TK[\-\u2010-\u2015'’`´]/i, "TK-")
    .toUpperCase();
}

export function isValidTicketCode(code: string): boolean {
  return ALLOWED.test(code);
}
