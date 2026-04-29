-- 033_tickets_audit.sql — Audit + atomic claim for agent ticket verification
BEGIN;

-- CHECK constraint sullo status (enforcement contratto RPC)
ALTER TABLE tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open','won','lost','void','claimed','expired'));

-- FK claimed_by → admin_users.id
ALTER TABLE tickets
  ADD CONSTRAINT tickets_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES admin_users(id);

-- Log ricevute (stampa + ristampe)
CREATE TABLE IF NOT EXISTS ticket_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  printed_by UUID REFERENCES admin_users(id),
  printed_at TIMESTAMPTZ DEFAULT NOW(),
  receipt_type TEXT NOT NULL CHECK (receipt_type IN ('payment','reprint'))
);
CREATE INDEX idx_receipts_ticket ON ticket_receipts(ticket_id);
CREATE INDEX idx_receipts_agent_date ON ticket_receipts(printed_by, printed_at);

ALTER TABLE ticket_receipts ENABLE ROW LEVEL SECURITY;
-- Tutto via service role dal server, nessuna policy pubblica
CREATE POLICY ticket_receipts_service_only ON ticket_receipts FOR ALL USING (false);

-- Indexes per get_agent_shift_stats (hot path /api/tickets/shift)
CREATE INDEX IF NOT EXISTS idx_tickets_claimed_by_at ON tickets(claimed_by, claimed_at) WHERE claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_printed_at ON tickets(printed_at);

-- RPC claim atomica (race-safe)
CREATE OR REPLACE FUNCTION claim_ticket(p_code TEXT, p_admin_id UUID)
RETURNS TABLE(ticket_id UUID, amount_paid DECIMAL, already_claimed BOOLEAN, not_payable BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
  v_amount DECIMAL;
  v_status TEXT;
BEGIN
  UPDATE tickets
    SET status = 'claimed',
        claimed_at = NOW(),
        claimed_by = p_admin_id,
        updated_at = NOW()
    WHERE ticket_code = UPPER(p_code)
      AND status IN ('won', 'void')
      AND (expires_at IS NULL OR expires_at > NOW())
    RETURNING id, win_amount INTO v_id, v_amount;

  IF v_id IS NULL THEN
    SELECT status INTO v_status FROM tickets WHERE ticket_code = UPPER(p_code);
    IF v_status IS NULL THEN
      -- Not found
      RETURN QUERY SELECT NULL::UUID, NULL::DECIMAL, FALSE, FALSE;
    ELSIF v_status = 'claimed' THEN
      RETURN QUERY SELECT NULL::UUID, NULL::DECIMAL, TRUE, FALSE;
    ELSE
      -- Not payable (open/lost/expired)
      RETURN QUERY SELECT NULL::UUID, NULL::DECIMAL, FALSE, TRUE;
    END IF;
  ELSE
    INSERT INTO ticket_receipts(ticket_id, printed_by, receipt_type)
      VALUES (v_id, p_admin_id, 'payment');
    RETURN QUERY SELECT v_id, v_amount, FALSE, FALSE;
  END IF;
END $$;

-- RPC KPI turno: per-operator paid, platform-wide printed
CREATE OR REPLACE FUNCTION get_agent_shift_stats(p_admin_id UUID, p_since TIMESTAMPTZ)
RETURNS TABLE(
  tickets_paid INT,
  total_paid DECIMAL,
  tickets_count_today INT,
  total_printed_today DECIMAL
) LANGUAGE sql AS $$
  SELECT
    (SELECT COUNT(*)::INT FROM tickets
       WHERE claimed_by = p_admin_id AND claimed_at >= p_since),
    (SELECT COALESCE(SUM(win_amount),0) FROM tickets
       WHERE claimed_by = p_admin_id AND claimed_at >= p_since),
    (SELECT COUNT(*)::INT FROM tickets WHERE printed_at >= p_since),
    (SELECT COALESCE(SUM(stake),0) FROM tickets WHERE printed_at >= p_since);
$$;

-- RPC unlock expired (super_admin only — check in API layer)
CREATE OR REPLACE FUNCTION unlock_expired_ticket(p_code TEXT, p_admin_id UUID)
RETURNS TABLE(ticket_id UUID, new_status TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
  v_bet_status TEXT;
  v_win DECIMAL;
BEGIN
  SELECT t.id, b.status, b.potential_win INTO v_id, v_bet_status, v_win
    FROM tickets t JOIN bets b ON b.id = t.bet_id
    WHERE t.ticket_code = UPPER(p_code) AND t.status = 'expired';

  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF v_bet_status = 'won' THEN
    UPDATE tickets SET status='won', win_amount=v_win, updated_at=NOW() WHERE id=v_id;
    RETURN QUERY SELECT v_id, 'won'::TEXT;
  ELSIF v_bet_status = 'void' THEN
    UPDATE tickets SET status='void', updated_at=NOW() WHERE id=v_id;
    RETURN QUERY SELECT v_id, 'void'::TEXT;
  ELSE
    RETURN QUERY SELECT v_id, v_bet_status::TEXT; -- lost → rimane non pagabile
  END IF;
END $$;

COMMIT;
