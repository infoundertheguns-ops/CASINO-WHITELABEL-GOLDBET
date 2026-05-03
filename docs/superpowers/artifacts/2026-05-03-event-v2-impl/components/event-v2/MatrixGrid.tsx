// components/event-v2/MatrixGrid.tsx
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
  rowLabels: string[];
  colLabels: string[];
  keyPrefix: string[];
  outcomes: Map<string, OutcomeData>;
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

export default function MatrixGrid({
  rowLabels, colLabels, keyPrefix, outcomes, onSelect,
}: Props) {
  const cols = colLabels.length;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `60px repeat(${cols}, 1fr)`,
      gap: 4,
      background: "#f5f5f5",
      padding: 8,
      borderRadius: 4,
    }}>
      <div />
      {colLabels.map((label, i) => (
        <div
          key={`col-${i}`}
          style={{
            textAlign: "center",
            fontWeight: "bold",
            padding: 6,
            background: "#d0141c",
            color: "white",
            borderRadius: 3,
            fontSize: 11,
          }}
        >{label}</div>
      ))}

      {rowLabels.map((rowLabel, r) => (
        <Fragment key={`row-frag-${r}`}>
          <div
            style={{
              textAlign: "center",
              fontWeight: "bold",
              padding: 6,
              background: "#d0141c",
              color: "white",
              borderRadius: 3,
              alignSelf: "center",
              fontSize: 11,
            }}
          >{rowLabel}</div>
          {colLabels.map((_, c) => {
            const key = `${keyPrefix[r]}/${keyPrefix[c]}`;
            const outcome = outcomes.get(key);
            if (!outcome) {
              return (
                <div
                  key={`cell-${r}-${c}`}
                  style={{
                    textAlign: "center",
                    padding: 14,
                    background: "#e0e0e0",
                    color: "#999",
                    borderRadius: 4,
                    opacity: 0.6,
                  }}
                >—</div>
              );
            }
            return (
              <OutcomeButton
                key={`cell-${r}-${c}`}
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
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
