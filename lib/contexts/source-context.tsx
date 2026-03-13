"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

type LiveSource = "leon" | "kambi";

interface SourceContextValue {
  liveSource: LiveSource;
  setLiveSource: (source: LiveSource) => Promise<void>;
  loading: boolean;
}

const SourceContext = createContext<SourceContextValue>({
  liveSource: "leon",
  setLiveSource: async () => {},
  loading: true,
});

export function SourceProvider({ children }: { children: ReactNode }) {
  const [liveSource, setLiveSourceState] = useState<LiveSource>("leon");
  const [loading, setLoading] = useState(true);

  // Fetch current live source on mount
  useEffect(() => {
    fetch("/api/config/live-source")
      .then((r) => r.json())
      .then((data) => {
        if (data.source === "leon" || data.source === "kambi") {
          setLiveSourceState(data.source);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setLiveSource = useCallback(async (source: LiveSource) => {
    try {
      const resp = await fetch("/api/config/live-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (resp.ok) {
        setLiveSourceState(source);
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <SourceContext.Provider value={{ liveSource, setLiveSource, loading }}>
      {children}
    </SourceContext.Provider>
  );
}

export function useLiveSource() {
  return useContext(SourceContext);
}
