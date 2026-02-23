import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { User, Wallet } from "@/lib/types";

interface AuthState {
  user: User | null;
  wallet: Wallet | null;
  isLoading: boolean;
  isAdmin: boolean;

  // Actions
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, username: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshWallet: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  wallet: null,
  isLoading: true,
  isAdmin: false,

  initialize: async () => {
    const supabase = createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
      set({ user: null, wallet: null, isLoading: false, isAdmin: false });
      return;
    }

    // Fetch user profile
    const { data: profile } = await supabase
      .from("users")
      .select("*")
      .eq("id", authUser.id)
      .single();

    // Fetch wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", authUser.id)
      .single();

    // Check admin
    const { data: admin } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", authUser.id)
      .single();

    set({
      user: profile,
      wallet: wallet,
      isLoading: false,
      isAdmin: !!admin,
    });

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_OUT") {
        set({ user: null, wallet: null, isAdmin: false });
      }
    });
  },

  signIn: async (email, password) => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) return { error: error.message };

    await get().initialize();
    return {};
  },

  signUp: async (email, password, username) => {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username } },
    });

    if (error) return { error: error.message };

    // Create user profile
    if (data.user) {
      await supabase.from("users").insert({
        id: data.user.id,
        email,
        username,
        display_name: username,
      });

      // Create wallet
      await supabase.from("wallets").insert({
        user_id: data.user.id,
        currency: "USDT",
        balance: 0,
        bonus_balance: 0,
        locked_balance: 0,
      });
    }

    await get().initialize();
    return {};
  },

  signOut: async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    set({ user: null, wallet: null, isAdmin: false });
  },

  refreshWallet: async () => {
    const user = get().user;
    if (!user) return;

    const supabase = createClient();
    const { data: wallet } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (wallet) set({ wallet });
  },
}));
