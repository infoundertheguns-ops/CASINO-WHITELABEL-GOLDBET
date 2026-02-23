import { create } from "zustand";

type AdminTheme = "dark" | "light";

interface AdminThemeStore {
  theme: AdminTheme;
  toggle: () => void;
  setTheme: (t: AdminTheme) => void;
}

export const useAdminTheme = create<AdminThemeStore>((set) => ({
  theme: (typeof window !== "undefined" ? localStorage.getItem("admin-theme") as AdminTheme : null) || "dark",
  toggle: () =>
    set((state) => {
      const next = state.theme === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") localStorage.setItem("admin-theme", next);
      return { theme: next };
    }),
  setTheme: (t) => {
    if (typeof window !== "undefined") localStorage.setItem("admin-theme", t);
    set({ theme: t });
  },
}));
