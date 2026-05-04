// components/event-v2/LinePicker.tsx
"use client";

import { useState } from "react";
import OutcomeButton from "./OutcomeButton";
import { MEDIAN_LINE } from "@/lib/line-picker-defaults";

type OutcomeShape = {
  outcomeId: string;
  outcomeIdV2: string;
  name: string;
  odds: number;
  isSuspended?: boolean;
  isManualSuspended?: boolean;
  oddsChange?: 'up' | 'down' | null;
};

type LineVariant = {
  line: number;
  marketId: string;
  marketIdV2: string;
  outcomes: OutcomeShape[];
};

type Renderer = 'under-over' | 'team-handicap' | 'cards-corners' | 'shots';

type Props = {
  marketFamily: string;
  variants: LineVariant[];
  defaultLine: number;
  topVisibleCount?: number;
  outcomeRenderer: Renderer;
  expandedInitially?: boolean;
  homeTeamName?: string;
  awayTeamName?: string;
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

function pickDefault(variants: LineVariant[], target: number): LineVariant | null {
  if (variants.length === 0) return null;
  const sorted = [...variants].sort((a, b) => a.line - b.line);
  if (target === MEDIAN_LINE) {
    return sorted[Math.floor(sorted.length / 2)];
  }
  return [...sorted].sort((a, b) => {
    const da = Math.abs(a.line - target);
    const db = Math.abs(b.line - target);
    if (da !== db) return da - db;
    return a.line - b.line;
  })[0];
}

function renderLabel(renderer: Renderer, outcome: OutcomeShape, line: number, home?: string, away?: string): string {
  switch (renderer) {
    case 'team-handicap': {
      const n = (outcome.name || '').toLowerCase().trim();
      const isHome = n === '1' || n === 'home';
      const teamForOutcome = isHome ? home : away;
      const effectiveLine = isHome ? line : -line;
      // Special-case 0 handicap: don't show "+0"/"-0" — just team name.
      if (effectiveLine === 0) return `${teamForOutcome ?? outcome.name}`;
      const formatted = effectiveLine % 1 === 0 ? effectiveLine.toFixed(0) : effectiveLine.toFixed(2);
      const sign = effectiveLine < 0 ? formatted : `+${formatted}`;
      return `${teamForOutcome ?? outcome.name} ${sign}`;
    }
    default:
      return outcome.name;
  }
}

export default function LinePicker({
  marketFamily, variants, defaultLine, topVisibleCount = 3,
  outcomeRenderer, expandedInitially = false,
  homeTeamName, awayTeamName, onSelect,
}: Props) {
  const [expanded, setExpanded] = useState(expandedInitially);
  if (variants.length === 0) return null;

  const sorted = [...variants].sort((a, b) => a.line - b.line);
  const defaultVariant = pickDefault(sorted, defaultLine);
  if (!defaultVariant) return null;

  const defaultIdx = sorted.indexOf(defaultVariant);

  const startIdx = Math.max(0, defaultIdx - 1);
  const endIdx = Math.min(sorted.length, defaultIdx + 2);
  const topVisible = sorted.slice(startIdx, endIdx);
  const remaining = sorted.filter(v => !topVisible.includes(v));
  const visibleSet = expanded ? sorted : topVisible;

  return (
    <div style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 13 }}>
      {visibleSet.map(v => (
        <div
          key={v.marketId}
          data-line={v.line}
          style={{
            display: 'grid',
            gridTemplateColumns: '60px 1fr 1fr',
            gap: 6,
            padding: '8px 0',
            borderBottom: '1px solid #eee',
            alignItems: 'center',
            background: v === defaultVariant ? '#fffbe6' : 'transparent',
          }}
        >
          <div
            style={{
              background: v === defaultVariant ? '#FFC107' : '#666',
              color: v === defaultVariant ? '#333' : 'white',
              fontWeight: 'bold',
              fontSize: 14,
              textAlign: 'center',
              padding: '10px 4px',
              borderRadius: 3,
              alignSelf: 'stretch',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {v.line}{v === defaultVariant ? ' ★' : ''}
          </div>
          {(() => {
            if (outcomeRenderer === 'under-over') {
              return [...v.outcomes].sort((a, b) => {
                const al = (a.name || '').toLowerCase();
                const bl = (b.name || '').toLowerCase();
                const aOver = al.startsWith('over') || al.startsWith('piu');
                const bOver = bl.startsWith('over') || bl.startsWith('piu');
                return (aOver ? 0 : 1) - (bOver ? 0 : 1);
              });
            }
            if (outcomeRenderer === 'team-handicap') {
              return [...v.outcomes].sort((a, b) => {
                const an = (a.name || '').toLowerCase().trim();
                const bn = (b.name || '').toLowerCase().trim();
                const aHome = an === '1' || an === 'home';
                const bHome = bn === '1' || bn === 'home';
                return (aHome ? 0 : 1) - (bHome ? 0 : 1);
              });
            }
            return v.outcomes;
          })().map(o => (
            <OutcomeButton
              key={o.outcomeId}
              outcomeId={o.outcomeId}
              outcomeIdV2={o.outcomeIdV2}
              label={renderLabel(outcomeRenderer, o, v.line, homeTeamName, awayTeamName)}
              odds={o.odds}
              isSuspended={o.isSuspended ?? false}
              isManualSuspended={o.isManualSuspended ?? false}
              oddsChange={o.oddsChange ?? null}
              size="standard"
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
      {!expanded && remaining.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            width: '100%',
            padding: 12,
            background: 'white',
            border: '1px dashed #aaa',
            borderRadius: 4,
            marginTop: 8,
            color: '#d0141c',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >+ altre {remaining.length} linee</button>
      )}
    </div>
  );
}
