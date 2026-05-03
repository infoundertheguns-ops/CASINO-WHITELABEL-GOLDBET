import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AsianHandicapBlock from "@/components/event-v2/AsianHandicapBlock";

const mkAHVariant = (line: number, homeOdds: number, awayOdds: number) => ({
  line,
  marketId: `m${line}`,
  marketIdV2: `v${line}`,
  outcomes: [
    { outcomeId: `h${line}`, outcomeIdV2: `vh${line}`, name: "1", odds: homeOdds },
    { outcomeId: `a${line}`, outcomeIdV2: `va${line}`, name: "2", odds: awayOdds },
  ],
});

describe("AsianHandicapBlock", () => {
  it("renders with team labels (Inter -0.5 / Milan +0.5)", () => {
    const variants = [
      mkAHVariant(-1.5, 3.20, 1.36),
      mkAHVariant(-0.5, 2.05, 1.78),
      mkAHVariant(-0.25, 1.95, 1.85),
    ];
    render(<AsianHandicapBlock variants={variants} homeTeamName="Inter" awayTeamName="Milan" onSelect={() => {}} />);
    expect(screen.getByText(/Inter -0\.25/)).toBeInTheDocument();
    expect(screen.getByText(/Milan \+0\.25/)).toBeInTheDocument();
  });

  it("default line is the one with smallest absolute value", () => {
    const variants = [mkAHVariant(-1.5, 3.20, 1.36), mkAHVariant(-0.5, 2.05, 1.78)];
    render(<AsianHandicapBlock variants={variants} homeTeamName="Inter" awayTeamName="Milan" onSelect={() => {}} />);
    expect(screen.getByText(/-0\.5.*★/)).toBeInTheDocument();
  });

  it("returns null with no variants", () => {
    const { container } = render(<AsianHandicapBlock variants={[]} homeTeamName="Inter" awayTeamName="Milan" onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
