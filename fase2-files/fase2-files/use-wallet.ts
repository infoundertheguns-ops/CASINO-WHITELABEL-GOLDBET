"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";

export interface WalletData {
  balance: number;
  bonus_balance: number;
  locked_balance: number;
}

export interface Transaction {
  id: string;
  type: "deposit" | "withdrawal" | "bet" | "win" | "bonus" | "fee";
  amount: number;
  currency: string;
  status: string;
  description?: string;
  created_at: string;
}

export interface CryptoAddress {
  coin: string;
  symbol: string;
  address: string | null;
  network: string;
  icon: string;
  color: string;
}

const SUPPORTED_COINS: Omit<CryptoAddress, "address">[] = [
  { coin: "BTC", symbol: "₿", network: "Bitcoin", icon: "₿", color: "#f7931a" },
  { coin: "ETH", symbol: "Ξ", network: "Ethereum (ERC-20)", icon: "Ξ", color: "#627eea" },
  { coin: "USDT_TRC", symbol: "₮", network: "Tron (TRC-20)", icon: "₮", color: "#26a17b" },
  { coin: "SOL", symbol: "◎", network: "Solana", icon: "◎", color: "#9945ff" },
];

export function useWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [addresses, setAddresses] = useState<CryptoAddress[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  // Fetch wallet balance
  const fetchWallet = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("wallets")
      .select("balance, bonus_balance, locked_balance")
      .eq("user_id", user.id)
      .single();
    if (data) setWallet(data);
  }, [user]);

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setTransactions(data);
  }, [user]);

  // Fetch or generate deposit addresses
  const fetchAddresses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_crypto_wallets")
      .select("coin, address")
      .eq("user_id", user.id);

    const addressMap = new Map(data?.map((a) => [a.coin, a.address]) || []);

    setAddresses(
      SUPPORTED_COINS.map((c) => ({
        ...c,
        address: addressMap.get(c.coin) || null,
      }))
    );
  }, [user]);

  // Generate a new deposit address
  const generateAddress = async (coin: string): Promise<string | null> => {
    if (!user) return null;

    // In production this would call a crypto API
    // For now, generate a placeholder address
    const prefixes: Record<string, string> = {
      BTC: "bc1q",
      ETH: "0x",
      USDT_TRC: "T",
      SOL: "",
    };
    const randomHex = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
    const address = `${prefixes[coin] || ""}${randomHex}`.slice(0, 42);

    // Save to database
    const { error } = await supabase.from("user_crypto_wallets").upsert({
      user_id: user.id,
      coin,
      address,
      is_active: true,
    }, { onConflict: "user_id,coin" });

    if (!error) {
      await fetchAddresses();
      return address;
    }
    return null;
  };

  // Request withdrawal
  const requestWithdrawal = async (
    coin: string,
    amount: number,
    address: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: "Non autenticato" };
    if (!wallet) return { success: false, error: "Wallet non disponibile" };
    if (amount > wallet.balance) return { success: false, error: "Saldo insufficiente" };
    if (amount <= 0) return { success: false, error: "Importo non valido" };

    // Get currency ID
    const { data: currency } = await supabase
      .from("crypto_currencies")
      .select("id")
      .eq("symbol", coin)
      .single();

    if (!currency) return { success: false, error: "Valuta non supportata" };

    const { error } = await supabase.from("crypto_withdrawals").insert({
      user_id: user.id,
      currency_id: currency.id,
      amount_usdt: amount,
      amount_crypto: amount, // simplified, would use exchange rate
      exchange_rate: 1,
      to_address: address,
      status: "pending",
      risk_score: 0,
    });

    if (error) return { success: false, error: error.message };

    await fetchWallet();
    await fetchTransactions();
    return { success: true };
  };

  // Initialize
  useEffect(() => {
    if (user) {
      setLoading(true);
      Promise.all([fetchWallet(), fetchTransactions(), fetchAddresses()]).finally(
        () => setLoading(false)
      );
    }
  }, [user, fetchWallet, fetchTransactions, fetchAddresses]);

  // Real-time subscription for wallet updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("wallet-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wallets",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchWallet();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchTransactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return {
    wallet,
    transactions,
    addresses,
    loading,
    generateAddress,
    requestWithdrawal,
    refreshWallet: fetchWallet,
  };
}
