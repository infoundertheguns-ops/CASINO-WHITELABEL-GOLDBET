// components/event-v2/ScoreGrid.tsx
"use client";

import { Fragment } from "react";
import OutcomeButton from "./OutcomeButton";

type OutcomeData = {
  outcomeId: string;
  outcomeIdV2: string;
  odds: number;
  isSuspended?: boolean;
  isManualSuspended?: boolean;
  oddsChange?: "up" | "down" | null;
};

type Props = {
  homeMaxGoals?: number;
  awayMaxGoals?: number;
  outcomes: Map<string, OutcomeData>;
  highlightedScore?: string;
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

function buildLabels(maxGoals: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < maxGoals; i++) result.push(String(i));
  result.push(`${maxGoals}+`);
  return result;
}

export default function ScoreGrid({
  homeMaxGoals = 4,
  awayMaxGoals = 4,
  outcomes,
  highlightedScore = "1-1",
  onSelect,
}: Props) {
  const homeLabels = buildLabels(homeMaxGoals);
  const awayLabels = buildLabels(awayMaxGoals);
  const cols = awayLabels.length;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `36px repeat(${cols}, 1fr)`,
        gap: 3,
        background: "#f5f5f5",
        padding: 8,
        borderRadius: 4,
      }}
    >
      <div />
      {awayLabels.map((label, i) => (
        <div
          key={`col-${i}`}
          style={{
            textAlign: "center",
            fontWeight: "bold",
            padding: 4,
            background: "#003a7e",
            color: "white",
            borderRadius: 3,
            fontSize: 10,
          }}
        >
          {label}
        </div>
      ))}

      {homeLabels.map((homeLabel, r) => (
        <Fragment key={`row-${r}`}>
          <div
            style={{
              textAlign: "center",
              fontWeight: "bold",
              padding: 4,
              background: "#c8102e",
              color: "white",
              borderRadius: 3,
              fontSize: 10,
              alignSelf: "center",
            }}
          >
            {homeLabel}
          </div>
          {awayLabels.map((awayLabel, c) => {
            const key = `${homeLabel}-${awayLabel}`;
            const outcome = outcomes.get(key);
            const isHighlighted = key === highlightedScore;

            if (!outcome) {
              return (
                <div
                  key={`cell-${r}-${c}`}
                  style={{
                    textAlign: "center",
                    padding: 10,
                    background: "#e0e0e0",
                    color: "#999",
                    borderRadius: 3,
                    opacity: 0.5,
                    fontSize: 11,
                  }}
                >
                  —
                </div>
              );
            }
            return (
              <div
                key={`cell-${r}-${c}`}
                data-highlighted={isHighlighted ? "true" : "false"}
                style={{
                  background: isHighlighted ? "#fffbe6" : "transparent",
                  border: isHighlighted ? "2px solid #FFC107" : "none",
                  borderRadius: 3,
                }}
              >
                <OutcomeButton
                  outcomeId={outcome.outcomeId}
                  outcomeIdV2={outcome.outcomeIdV2}
                  label={key}
                  odds={outcome.odds}
                  isSuspended={outcome.isSuspended ?? false}
                  isManualSuspended={outcome.isManualSuspended ?? false}
                  oddsChange={outcome.oddsChange ?? null}
                  size="compact"
                  onSelect={onSelect}
                />
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
