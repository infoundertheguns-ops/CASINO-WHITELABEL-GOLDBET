// components/event-v2/AsianHandicapBlock.tsx
"use client";

import LinePicker from "./LinePicker";

type OutcomeShape = {
  outcomeId: string;
  outcomeIdV2: string;
  name: string;
  odds: number;
  isSuspended?: boolean;
  isManualSuspended?: boolean;
  oddsChange?: "up" | "down" | null;
};

type LineVariant = {
  line: number;
  marketId: string;
  marketIdV2: string;
  outcomes: OutcomeShape[];
};

type Props = {
  variants: LineVariant[];
  homeTeamName: string;
  awayTeamName: string;
  marketFamily?: string;
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

export default function AsianHandicapBlock({
  variants,
  homeTeamName,
  awayTeamName,
  marketFamily = "AH",
  onSelect,
}: Props) {
  if (variants.length === 0) return null;

  return (
    <LinePicker
      marketFamily={marketFamily}
      variants={variants}
      defaultLine={0}
      outcomeRenderer="team-handicap"
      homeTeamName={homeTeamName}
      awayTeamName={awayTeamName}
      onSelect={onSelect}
    />
  );
}
