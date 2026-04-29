// lib/admin/canonicalization-signals.ts
// Pure helpers for /admin/canonicalization page UI (color/icon/tooltip).

import type { SignalState, LevelColor } from './canonicalization-types';

export function signalToIcon(s: SignalState): string {
  switch (s) {
    case 'ok':
    case 'ok_verified':
      return '✅';
    case 'ok_synthetic':
      return '🔗';
    case 'variant':
      return '⚠️';
    case 'absent_ok':
      return '✓';
    case 'absent_problem':
      return '❌';
    case 'feature_pending':
      return '🚧';
    case 'structural_source_only':
      return '🔒';
    default:
      return '?';
  }
}

export function signalToTooltip(s: SignalState): string {
  switch (s) {
    case 'ok':
      return 'Presente e canonicalizzato';
    case 'ok_verified':
      return 'Presente, canonicalizzato e verificato';
    case 'ok_synthetic':
      return 'Identità sintetica cross-source (canonical_id assegnato dall\'engine)';
    case 'variant':
      return 'Presente ma con variant del valore (es. "Unknown" o nome non standard)';
    case 'absent_ok':
      return 'Campo opzionale non popolato (atteso)';
    case 'absent_problem':
      return 'Campo che il source dovrebbe popolare ma non lo fa';
    case 'feature_pending':
      return 'Feature non ancora attiva — vedi roadmap';
    case 'structural_source_only':
      return 'Strutturalmente single-source: questa lega non è coperta da Flashscore (es. Setka Cup, Esports Battle, Alternative Matches). Escluso dal denominatore di "coverage tra mappabili".';
    default:
      return 'Stato sconosciuto';
  }
}

export function pctToColor(pct: number | null | undefined): LevelColor {
  if (pct === null || pct === undefined) return 'gray';
  if (pct >= 90) return 'green';
  if (pct >= 60) return 'yellow';
  return 'red';
}

export function formatPct(pct: number): string {
  // Truncate to 1 decimal (not round) to avoid 99.95 → "100.0%" off-by-one optics
  const truncated = Math.floor(pct * 10) / 10;
  return `${truncated.toFixed(1)}%`;
}
