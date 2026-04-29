"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// E1.F4 — useAdminFilters hook.
// Syncs a generic filters object with the URL's searchParams so that admin
// pages can be deep-linked (share "Kambi unmapped confidence<50" as URL).
//
// Usage:
//   const { filters, setFilters, updateFilter } = useAdminFilters({
//     source: "all",
//     q: "",
//     onlyUnmapped: false,
//   });
//
// Behavior:
//   - On mount, hydrates filters from URL (falls back to defaults).
//   - When setFilters/updateFilter called, debounces URL update (150ms) to
//     avoid flooding history stack on fast typing.
//   - URL uses `replace` (not `push`) — no history pollution.
//   - Booleans serialized as "1" / absent. Numbers as toString.
//   - Keys with value === defaults[key] are omitted from URL (clean URLs).

type PrimitiveValue = string | number | boolean;
type FiltersShape = Record<string, PrimitiveValue>;

function serialize(val: PrimitiveValue): string | null {
  if (typeof val === "boolean") return val ? "1" : null;
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : null;
  if (typeof val === "string") return val.length > 0 ? val : null;
  return null;
}

function deserialize<T extends PrimitiveValue>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof fallback === "boolean") return (raw === "1") as T;
  if (typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  return raw as T;
}

export function useAdminFilters<T extends FiltersShape>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const defaultsRef = useRef(defaults);

  // Hydrate initial state from URL.
  const initial = useMemo(() => {
    const out = { ...defaultsRef.current };
    for (const k of Object.keys(defaultsRef.current)) {
      const raw = searchParams.get(k);
      out[k as keyof T] = deserialize(raw, defaultsRef.current[k]) as T[keyof T];
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filters, setFiltersState] = useState<T>(initial);

  // Debounced URL sync.
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      for (const k of Object.keys(filters)) {
        const currentSer = serialize(filters[k]);
        const defaultSer = serialize(defaultsRef.current[k]);
        if (currentSer === null || currentSer === defaultSer) {
          sp.delete(k);
        } else {
          sp.set(k, currentSer);
        }
      }
      const qs = sp.toString();
      const target = qs ? `${pathname}?${qs}` : pathname;
      router.replace(target, { scroll: false });
    }, 150);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const setFilters = useCallback((patch: Partial<T> | ((prev: T) => T)) => {
    setFiltersState((prev) => (typeof patch === "function" ? (patch as (p: T) => T)(prev) : { ...prev, ...patch }));
  }, []);

  const updateFilter = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setFiltersState((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { filters, setFilters, updateFilter };
}
