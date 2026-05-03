// components/event-v2/HeroOutcomeRow.tsx
"use client";
import OutcomeButton from "./OutcomeButton";

type OutcomeData = {
  outcomeId: string;
  outcomeIdV2: string;
  label: string;
  odds: number;
  isSuspended?: boolean;
  isManualSuspended?: boolean;
  oddsChange?: "up" | "down" | null;
};

type Props = {
  outcomes: OutcomeData[];
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

export default function HeroOutcomeRow({ outcomes, onSelect }: Props) {
  const cols = outcomes.length;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 6,
    }}>
      {outcomes.map(o => (
        <OutcomeButton
          key={o.outcomeId}
          outcomeId={o.outcomeId}
          outcomeIdV2={o.outcomeIdV2}
          label={o.label}
          odds={o.odds}
          isSuspended={o.isSuspended ?? false}
          isManualSuspended={o.isManualSuspended ?? false}
          oddsChange={o.oddsChange ?? null}
          size="hero"
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
