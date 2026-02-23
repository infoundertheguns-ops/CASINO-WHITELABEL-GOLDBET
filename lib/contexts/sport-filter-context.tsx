"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface SportFilterState {
  activeSport: string | null;
  setActiveSport: (slug: string | null) => void;
  activeLeague: string | null;
  setActiveLeague: (slug: string | null) => void;
}

const SportFilterContext = createContext<SportFilterState | null>(null);

export function SportFilterProvider({ children }: { children: ReactNode }) {
  const [activeSport, setActiveSportRaw] = useState<string | null>(null);
  const [activeLeague, setActiveLeague] = useState<string | null>(null);

  const setActiveSport = useCallback((slug: string | null) => {
    setActiveSportRaw(slug);
    setActiveLeague(null);
  }, []);

  return (
    <SportFilterContext.Provider value={{ activeSport, setActiveSport, activeLeague, setActiveLeague }}>
      {children}
    </SportFilterContext.Provider>
  );
}

export function useSportFilter() {
  const ctx = useContext(SportFilterContext);
  if (!ctx) throw new Error("useSportFilter must be used within SportFilterProvider");
  return ctx;
}
