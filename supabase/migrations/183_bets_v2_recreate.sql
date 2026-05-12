-- Sprint 4 / Phase 3 — recreate bets + bet_selections after big-bang DROP CASCADE.
-- Same column schema as legacy (preserves compatibility with 26 admin/player/cron files).
-- FK constraints now point to v2 tables (events_v2, markets_v2, outcomes_v2).
-- Mig 2026-05-12.

CREATE TABLE IF NOT EXISTS public.bets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid,
    kiosk_id uuid,
    bet_type text NOT NULL,
    stake numeric(14,2) NOT NULL,
    total_odds numeric(12,4),
    potential_win numeric(14,2),
    actual_win numeric(14,2) DEFAULT 0,
    status text DEFAULT 'open',
    is_live boolean DEFAULT false,
    is_free_bet boolean DEFAULT false,
    free_bet_id uuid,
    selections_count integer DEFAULT 1,
    ip_address text,
    risk_score integer DEFAULT 0,
    risk_flags jsonb DEFAULT '[]'::jsonb,
    settled_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    requested_stake numeric(14,2),
    accepted_stake numeric(14,2),
    acceptance_mode text,
    accepted_by text,
    acceptance_note text,
    reviewed_at timestamptz,
    placed_ip text,
    placed_fingerprint text,
    time_to_kickoff_minutes integer,
    parent_bet_id uuid REFERENCES public.bets(id) ON DELETE CASCADE,
    combo_type text,
    combo_count integer,
    combos_won integer DEFAULT 0,
    CONSTRAINT bets_stake_check CHECK (stake > 0)
);

CREATE TABLE IF NOT EXISTS public.bet_selections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bet_id uuid NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
    event_id uuid REFERENCES public.events_v2(id) ON DELETE SET NULL,
    market_id uuid REFERENCES public.markets_v2(id) ON DELETE SET NULL,
    outcome_id uuid REFERENCES public.outcomes_v2(id) ON DELETE SET NULL,
    odds_at_placement numeric(8,2) NOT NULL,
    result text,
    settled_at timestamptz,
    source text DEFAULT 'sport' NOT NULL,
    ippica_race_id uuid,
    ippica_market_id uuid,
    ippica_odds_id uuid,
    ippica_tote_pool_id uuid,
    ippica_tote_combo_id uuid,
    CONSTRAINT bet_selections_source_check CHECK (source = ANY (ARRAY['sport'::text, 'ippica'::text, 'ippica_tote'::text]))
);

-- Indexes (preserve legacy access patterns)
CREATE INDEX IF NOT EXISTS idx_bets_user ON public.bets USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_bets_kiosk ON public.bets USING btree (kiosk_id) WHERE kiosk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bets_status ON public.bets USING btree (status);
CREATE INDEX IF NOT EXISTS idx_bets_created ON public.bets USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_parent ON public.bets USING btree (parent_bet_id) WHERE parent_bet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bets_settled_at ON public.bets USING btree (settled_at DESC) WHERE settled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bs_bet ON public.bet_selections USING btree (bet_id);
CREATE INDEX IF NOT EXISTS idx_bs_event ON public.bet_selections USING btree (event_id);
CREATE INDEX IF NOT EXISTS idx_bs_market ON public.bet_selections USING btree (market_id) WHERE market_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bs_outcome ON public.bet_selections USING btree (outcome_id) WHERE outcome_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bs_ippica_odds ON public.bet_selections USING btree (ippica_odds_id) WHERE source = 'ippica';
CREATE INDEX IF NOT EXISTS idx_bs_ippica_race ON public.bet_selections USING btree (ippica_race_id) WHERE source = 'ippica';

COMMENT ON TABLE public.bets IS 'Recreated 2026-05-12 post big-bang Sprint 4. Schema preserves legacy field set for backward-compat with 26 callers. FK on parent_bet_id self-ref.';
COMMENT ON TABLE public.bet_selections IS 'Recreated 2026-05-12 post big-bang Sprint 4. FK to events_v2/markets_v2/outcomes_v2 (v2 layer). Ippica refs preserved for horse racing flow.';
