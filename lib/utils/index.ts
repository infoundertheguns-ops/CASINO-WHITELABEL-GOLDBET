import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format currency */
export function formatCurrency(
  amount: number,
  currency = "EUR",
  compact = false
): string {
  if (compact) {
    if (amount >= 1_000_000) return `€${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `€${(amount / 1_000).toFixed(0)}K`;
  }
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/** Format USD for crypto amounts */
export function formatUSD(amount: number, compact = false): string {
  if (compact) {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

/** Format crypto amount (BTC: 8 decimals, ETH: 6, others: 2) */
export function formatCrypto(amount: number, coin: string): string {
  const decimals = coin === "BTC" ? 8 : coin === "ETH" ? 6 : 2;
  return `${amount.toFixed(decimals)} ${coin.replace("_TRC", "").replace("_ERC", "")}`;
}

/** Format odds (decimal, 2 decimals) */
export function formatOdds(odds: number): string {
  return odds.toFixed(2);
}

/** Decimal odds to implied probability */
export function oddsToProbability(odds: number): number {
  return (1 / odds) * 100;
}

/** Format percentage */
export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/** Format relative time ("2m fa", "1h fa", "Oggi 14:30") */
export function timeAgo(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "ora";
  if (diffMin < 60) return `${diffMin}m fa`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h fa`;
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

/** Truncate text */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

/** Shorten crypto address */
export function shortenAddress(address: string, chars = 6): string {
  return `${address.slice(0, chars)}...${address.slice(-4)}`;
}

/** Risk score color */
export function riskColor(score: number): string {
  if (score >= 70) return "text-red-400";
  if (score >= 40) return "text-orange-400";
  return "text-emerald-400";
}

/** Risk score bg */
export function riskBg(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-emerald-500";
}

/** Generate random ID for optimistic updates */
export function tempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
