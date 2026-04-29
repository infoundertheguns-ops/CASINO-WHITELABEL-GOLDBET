-- 109_kiosk_vouchers.sql
-- Voucher table for kiosk cashout ("PAGARE" button). Player hits the
-- button → backend creates a pending voucher + credit_unload tx atomically
-- + zeros the kiosk balance + returns the voucher code. The player
-- prints the thermal receipt with the code and brings it to the cashier,
-- who scans it to redeem (Step 2 — admin flow).

CREATE TABLE IF NOT EXISTS kiosk_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  kiosk_id uuid NOT NULL REFERENCES kiosks(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','redeemed','expired','voided')),
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_kiosk_vouchers_code ON kiosk_vouchers(code);
CREATE INDEX IF NOT EXISTS idx_kiosk_vouchers_kiosk_status ON kiosk_vouchers(kiosk_id, status);
CREATE INDEX IF NOT EXISTS idx_kiosk_vouchers_pending ON kiosk_vouchers(created_at DESC) WHERE status = 'pending';

ALTER TABLE kiosk_vouchers ENABLE ROW LEVEL SECURITY;
-- Service role only (no anon read/write). Cashout endpoint uses
-- createAdminClient → service_role; admin redemption page same.

COMMENT ON TABLE kiosk_vouchers IS 'Cashout vouchers issued by kiosks — player-printed, cashier-redeemed.';
