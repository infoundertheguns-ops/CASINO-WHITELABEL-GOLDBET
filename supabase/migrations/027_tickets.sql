-- 027_tickets.sql — Ticket system for kiosk bets

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code TEXT UNIQUE NOT NULL, -- short scannable code (e.g. "TK-A8F3E2")
  bet_id UUID NOT NULL REFERENCES bets(id),
  agent_id UUID REFERENCES agents(id), -- which agent's locale
  player_id UUID NOT NULL,

  -- Ticket info
  bet_type TEXT NOT NULL, -- singola, multi, sistema
  selections_count INT NOT NULL,
  stake DECIMAL(12,2) NOT NULL,
  total_odds DECIMAL(12,4),
  potential_win DECIMAL(12,2),

  -- Status
  status TEXT NOT NULL DEFAULT 'open', -- open, won, lost, void, claimed, expired
  win_amount DECIMAL(12,2), -- actual win (null until settled)

  -- Claim info
  claimed_at TIMESTAMPTZ,
  claimed_by UUID, -- agent user who claimed it

  -- Timestamps
  printed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- auto-expire after X days
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_code ON tickets(ticket_code);
CREATE INDEX IF NOT EXISTS idx_tickets_bet ON tickets(bet_id);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_player ON tickets(player_id);

-- RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tickets_read ON tickets FOR SELECT USING (true);
