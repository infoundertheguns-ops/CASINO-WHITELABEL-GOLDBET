-- Kiosks table
CREATE TABLE IF NOT EXISTS kiosks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kiosks_agent_id ON kiosks(agent_id);
CREATE INDEX idx_kiosks_code ON kiosks(code);

-- Kiosk wallets
CREATE TABLE IF NOT EXISTS kiosk_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_id UUID NOT NULL UNIQUE REFERENCES kiosks(id),
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kiosk transactions (Supabase Realtime will listen on this)
CREATE TABLE IF NOT EXISTS kiosk_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_id UUID NOT NULL REFERENCES kiosks(id),
  type TEXT NOT NULL CHECK (type IN ('credit_load', 'credit_unload', 'bet_debit', 'bet_void_refund')),
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  reference_id UUID,
  performed_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kiosk_transactions_kiosk_id ON kiosk_transactions(kiosk_id);
CREATE INDEX idx_kiosk_transactions_type ON kiosk_transactions(type);

-- Kiosk sessions
CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_id UUID NOT NULL REFERENCES kiosks(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kiosk_sessions_token ON kiosk_sessions(token);
CREATE INDEX idx_kiosk_sessions_kiosk_id ON kiosk_sessions(kiosk_id);

-- TOTP secret on agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS totp_secret TEXT;

-- Kiosk reference on bets and tickets
ALTER TABLE bets ADD COLUMN IF NOT EXISTS kiosk_id UUID REFERENCES kiosks(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS kiosk_id UUID REFERENCES kiosks(id);

-- Make user_id nullable for kiosk anonymous bets (kiosk bets have kiosk_id instead)
ALTER TABLE bets ALTER COLUMN user_id DROP NOT NULL;
-- Make player_id nullable for kiosk tickets (kiosk tickets have kiosk_id instead)
ALTER TABLE tickets ALTER COLUMN player_id DROP NOT NULL;

-- RLS: public read on all kiosk tables, writes via service role
ALTER TABLE kiosks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kiosks_select" ON kiosks FOR SELECT USING (true);

ALTER TABLE kiosk_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kiosk_wallets_select" ON kiosk_wallets FOR SELECT USING (true);

ALTER TABLE kiosk_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kiosk_transactions_select" ON kiosk_transactions FOR SELECT USING (true);

ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kiosk_sessions_select" ON kiosk_sessions FOR SELECT USING (true);

-- Enable Realtime on kiosk_transactions and kiosk_wallets
ALTER PUBLICATION supabase_realtime ADD TABLE kiosk_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE kiosk_wallets;

-- Function to generate unique 6-digit kiosk code
CREATE OR REPLACE FUNCTION generate_kiosk_code() RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    new_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    SELECT EXISTS(SELECT 1 FROM kiosks WHERE code = new_code) INTO code_exists;
    EXIT WHEN NOT code_exists;
  END LOOP;
  RETURN new_code;
END;
$$ LANGUAGE plpgsql;
