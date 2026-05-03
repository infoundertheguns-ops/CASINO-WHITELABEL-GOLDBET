// components/event-v2/EuropeanHandicapBlock.tsx
"use client";

import { useState, useMemo } from "react";
import OutcomeButton from "./OutcomeButton";

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

type Props = {
  variants: LineVariant[];
  defaultLine?: number;  // default -1
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

function pickClosest(variants: LineVariant[], target: number): LineVariant | null {
  if (variants.length === 0) return null;
  return [...variants].sort((a, b) => {
    const da = Math.abs(a.line - target);
    const db = Math.abs(b.line - target);
    if (da !== db) return da - db;
    return a.line - b.line;
  })[0];
}

function formatLineChip(line: number): string {
  const formatted = line % 1 === 0 ? Math.abs(line).toFixed(0) : Math.abs(line).toFixed(2);
  return line < 0 ? `−${formatted}` : `+${formatted}`;
}

export default function EuropeanHandicapBlock({
  variants, defaultLine = -1, onSelect,
}: Props) {
  if (variants.length === 0) return null;

  const sorted = useMemo(() => [...variants].sort((a, b) => a.line - b.line), [variants]);
  const initialDefault = useMemo(() => pickClosest(sorted, defaultLine), [sorted, defaultLine]);
  const [activeLine, setActiveLine] = useState<number>(initialDefault?.line ?? sorted[0].line);

  const activeVariant = sorted.find(v => v.line === activeLine) ?? initialDefault;
  if (!activeVariant) return null;

  // Reorder outcomes 1/X/2 deterministically
  const orderedOutcomes = ["1", "X", "2"].map(name =>
    activeVariant.outcomes.find(o => o.name === name)
  ).filter((o): o is OutcomeShape => o != null);

  return (
    <div style={{ background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6,
        marginBottom: 8,
      }}>
        {orderedOutcomes.map(o => (
          <OutcomeButton
            key={o.outcomeId}
            outcomeId={o.outcomeId}
            outcomeIdV2={o.outcomeIdV2}
            label={o.name}
            odds={o.odds}
            isSuspended={o.isSuspended ?? false}
            isManualSuspended={o.isManualSuspended ?? false}
            oddsChange={o.oddsChange ?? null}
            size="standard"
            onSelect={onSelect}
          />
        ))}
      </div>
      <div style={{
        display: 'flex',
        gap: 6,
        padding: 6,
        borderTop: '1px solid #eee',
        overflowX: 'auto',
      }}>
        {sorted.map(v => {
          const isActive = v.line === activeLine;
          return (
            <button
              key={v.marketId}
              type="button"
              data-line={v.line}
              data-active-chip={isActive ? 'true' : 'false'}
              onClick={() => setActiveLine(v.line)}
              style={{
                background: isActive ? '#d0141c' : 'white',
                color: isActive ? 'white' : '#333',
                border: isActive ? '2px solid #d0141c' : '2px solid #ddd',
                padding: '8px 14px',
                borderRadius: 16,
                fontSize: 12,
                fontWeight: 'bold',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >{formatLineChip(v.line)}</button>
          );
        })}
      </div>
    </div>
  );
}
