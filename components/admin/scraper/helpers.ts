// ═══ Helpers for Scraper Stats Dashboard ═══

export function formatNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
  return n.toLocaleString("it-IT");
}

export function formatNumFull(n: number): string {
  return n.toLocaleString("it-IT");
}

export function timeAgo(iso: string): string {
  if (!iso) return "\u2014";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s fa`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m fa`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m fa`;
}

export function formatUptime(seconds: number | undefined): string {
  if (!seconds) return "\u2014";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export function statusColor(status: string): string {
  if (status === "healthy") return "#10b981";
  if (status === "degraded") return "#f59e0b";
  if (status === "prematch-only") return "#3b82f6";
  return "#ef4444";
}

export function levelColor(level: string): string {
  if (level === "healthy") return "#10b981";
  if (level === "degraded") return "#f59e0b";
  return "#ef4444";
}

export function levelBg(level: string): string {
  if (level === "healthy") return "rgba(16, 185, 129, 0.06)";
  if (level === "degraded") return "rgba(245, 158, 11, 0.06)";
  return "rgba(239, 68, 68, 0.06)";
}

export function pillScoreColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

export function coverageColor(pct: number): string {
  if (pct >= 90) return "#10b981";
  if (pct >= 75) return "#f59e0b";
  return "#ef4444";
}

export function coverageBg(pct: number): string {
  if (pct >= 90) return "rgba(16, 185, 129, 0.1)";
  if (pct >= 75) return "rgba(245, 158, 11, 0.1)";
  return "rgba(239, 68, 68, 0.1)";
}

export function coveragePct(expected: number, actual: number): number {
  if (expected === 0) return actual === 0 ? 100 : 0;
  return Math.round((actual / expected) * 1000) / 10;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
