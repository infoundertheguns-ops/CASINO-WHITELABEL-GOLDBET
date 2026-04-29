-- 110_redeem_voucher_rpc.sql
-- Atomic voucher redemption — race-safe (same pattern as claim_ticket).
-- Returns the redeemed voucher row or raises on invalid/already-redeemed.

CREATE OR REPLACE FUNCTION redeem_voucher(
  p_code text,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher kiosk_vouchers%ROWTYPE;
BEGIN
  -- Lock the row; FOR UPDATE blocks concurrent redeem attempts.
  SELECT * INTO v_voucher
  FROM kiosk_vouchers
  WHERE code = p_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_voucher.status = 'redeemed' THEN
    RAISE EXCEPTION 'ALREADY_REDEEMED' USING ERRCODE = 'P0003',
      DETAIL = v_voucher.redeemed_at::text;
  END IF;

  IF v_voucher.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0004',
      DETAIL = v_voucher.status;
  END IF;

  UPDATE kiosk_vouchers
  SET status = 'redeemed',
      redeemed_at = now(),
      redeemed_by = p_admin_id
  WHERE id = v_voucher.id
  RETURNING * INTO v_voucher;

  RETURN jsonb_build_object(
    'id', v_voucher.id,
    'code', v_voucher.code,
    'amount', v_voucher.amount,
    'kiosk_id', v_voucher.kiosk_id,
    'redeemed_at', v_voucher.redeemed_at,
    'redeemed_by', v_voucher.redeemed_by,
    'created_at', v_voucher.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION redeem_voucher(text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_voucher(text, uuid) TO service_role;
