import { create } from "zustand";
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
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();

      set({
        user: data.user,
        wallet: data.wallet,
        isLoading: false,
        isAdmin: data.isAdmin || false,
      });
    } catch {
      set({ user: null, wallet: null, isLoading: false, isAdmin: false });
    }
  },

  signIn: async (email, password) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) return { error: data.error || "Errore di autenticazione" };

    await get().initialize();
    return {};
  },

  signUp: async (email, password, username) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, username }),
    });

    const data = await res.json();
    if (!res.ok) return { error: data.error || "Errore di registrazione" };

    await get().initialize();
    return {};
  },

  signOut: async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    set({ user: null, wallet: null, isAdmin: false });
  },

  refreshWallet: async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.wallet) set({ wallet: data.wallet });
    } catch {
      // ignore
    }
  },
}));
