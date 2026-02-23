-- Admin RLS policies: allow admin_users to read ALL data
-- Run in Supabase Dashboard → SQL Editor

CREATE POLICY admin_read_all_users ON public.users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true)
  );

CREATE POLICY admin_read_all_bets ON public.bets
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true)
  );

CREATE POLICY admin_read_all_bs ON public.bet_selections
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true)
  );

CREATE POLICY admin_read_all_wallets ON public.wallets
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true)
  );

CREATE POLICY admin_read_all_tx ON public.transactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true)
  );
