"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";

export interface Promo {
  id: string;
  name: string;
  desc: string;
  badge: string;
  cat: "casino" | "sport" | "torneo";
  color: string;
  icon: string;
  cta: string;
  details: string;
  bonus_type: string;
  bonus_value: number;
  wagering: number;
  min_deposit: number;
  max_bonus: number;
  expires_at?: string;
}

export interface UserPromo {
  id: string;
  promo_id: string;
  promo_name: string;
  status: "active" | "completed" | "expired" | "cancelled";
  bonus_amount: number;
  wagered: number;
  wagering_required: number;
  progress: number;
  claimed_at: string;
  expires_at?: string;
}

const PROMOS: Promo[] = [
  { id: "p1", name: "Bonus Benvenuto 100%", desc: "Fino a $1,000 + 200 Free Spins sul primo deposito", badge: "NUOVO", cat: "casino", color: "from-orange-500 to-orange-300", icon: "🎁", cta: "Attiva Bonus", details: "Wagering 35x · Scade in 30gg · Min deposito $20", bonus_type: "deposit_match", bonus_value: 100, wagering: 35, min_deposit: 20, max_bonus: 1000 },
  { id: "p2", name: "Free Bet $50", desc: "Scommessa gratis su eventi live questo weekend", badge: "SPORT", cat: "sport", color: "from-blue-500 to-blue-300", icon: "⚽", cta: "Riscuoti", details: "Quota min 1.80 · Solo live · Scade domenica", bonus_type: "free_bet", bonus_value: 50, wagering: 1, min_deposit: 0, max_bonus: 50 },
  { id: "p3", name: "Mega Spin Tournament", desc: "Montepremi $10,000 — Gioca slot Pragmatic e scala la classifica", badge: "LIVE", cat: "torneo", color: "from-yellow-500 to-orange-400", icon: "🏆", cta: "Partecipa", details: "Top 100 vincono · Min spin $0.50 · Fino a venerdì", bonus_type: "tournament", bonus_value: 0, wagering: 0, min_deposit: 0, max_bonus: 10000 },
  { id: "p4", name: "Cashback Casino 10%", desc: "Ricevi il 10% delle perdite settimanali fino a $500", badge: "WEEKLY", cat: "casino", color: "from-purple-500 to-pink-400", icon: "💰", cta: "Attiva", details: "Automatico ogni lunedì · Wagering 5x · Solo slot", bonus_type: "cashback", bonus_value: 10, wagering: 5, min_deposit: 0, max_bonus: 500 },
  { id: "p5", name: "Acca Boost +25%", desc: "Bonus del 25% sulle vincite delle multiple con 4+ selezioni", badge: "SPORT", cat: "sport", color: "from-green-500 to-emerald-400", icon: "📈", cta: "Dettagli", details: "Min 4 selezioni · Quota min 1.30 ciascuna · Max bonus $500", bonus_type: "odds_boost", bonus_value: 25, wagering: 0, min_deposit: 0, max_bonus: 500 },
  { id: "p6", name: "Valentine Race", desc: "Montepremi $2,000 speciale San Valentino", badge: "LIVE", cat: "torneo", color: "from-red-500 to-pink-400", icon: "❤️", cta: "Partecipa", details: "324 partecipanti · Top 20 vincono · Fino al 15 feb", bonus_type: "tournament", bonus_value: 0, wagering: 0, min_deposit: 0, max_bonus: 2000 },
];

export function usePromos() {
  const { user } = useAuth();
  const [userPromos, setUserPromos] = useState<UserPromo[]>([]);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const promos = PROMOS;

  const fetchUserPromos = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_promotions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) {
      setUserPromos(data.map(p => ({
        id: p.id,
        promo_id: p.promotion_id,
        promo_name: p.promo_name || "Bonus",
        status: p.status,
        bonus_amount: p.bonus_amount || 0,
        wagered: p.wagered_amount || 0,
        wagering_required: p.wagering_required || 0,
        progress: p.wagering_required > 0 ? Math.min(100, ((p.wagered_amount || 0) / p.wagering_required) * 100) : 100,
        claimed_at: p.created_at,
        expires_at: p.expires_at,
      })));
    }
  }, [user]);

  const claimPromo = async (promo: Promo): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: "Devi accedere" };

    // Check if already claimed
    const already = userPromos.find(p => p.promo_id === promo.id && p.status === "active");
    if (already) return { success: false, error: "Bonus già attivo" };

    // Ensure promotion exists in DB
    const { data: dbPromo } = await supabase
      .from("promotions")
      .select("id")
      .eq("name", promo.name)
      .single();

    let promoDbId = dbPromo?.id;
    if (!promoDbId) {
      const { data: newP } = await supabase
        .from("promotions")
        .insert({
          name: promo.name,
          description: promo.desc,
          promo_type: promo.bonus_type,
          status: "active",
          bonus_value: promo.bonus_value,
          wagering_requirement: promo.wagering,
          min_deposit: promo.min_deposit,
          max_bonus: promo.max_bonus,
          start_date: new Date().toISOString(),
          end_date: new Date(Date.now() + 30 * 86400000).toISOString(),
        })
        .select("id")
        .single();
      promoDbId = newP?.id;
    }

    const bonusAmount = promo.bonus_type === "free_bet" ? promo.bonus_value : 0;
    const wageringRequired = bonusAmount * promo.wagering;

    const { error } = await supabase.from("user_promotions").insert({
      user_id: user.id,
      promotion_id: promoDbId,
      promo_name: promo.name,
      status: "active",
      bonus_amount: bonusAmount,
      wagered_amount: 0,
      wagering_required: wageringRequired,
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    if (error) return { success: false, error: error.message };

    // If free bet, add to bonus balance
    if (bonusAmount > 0) {
      const { data: wallet } = await supabase
        .from("wallets")
        .select("bonus_balance")
        .eq("user_id", user.id)
        .single();
      
      if (wallet) {
        await supabase.from("wallets")
          .update({ bonus_balance: (wallet.bonus_balance || 0) + bonusAmount })
          .eq("user_id", user.id);
      }
    }

    await fetchUserPromos();
    return { success: true };
  };

  useEffect(() => {
    if (user) fetchUserPromos();
  }, [user, fetchUserPromos]);

  return { promos, userPromos, loading, claimPromo, fetchUserPromos };
}
