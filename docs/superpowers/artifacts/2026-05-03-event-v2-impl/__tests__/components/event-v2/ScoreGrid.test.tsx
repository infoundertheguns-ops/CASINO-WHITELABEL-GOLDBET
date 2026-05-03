import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScoreGrid from "@/components/event-v2/ScoreGrid";

const sampleScores = new Map([
  ["0-0", { outcomeId: "00", outcomeIdV2: "v00", odds: 11 }],
  ["1-0", { outcomeId: "10", outcomeIdV2: "v10", odds: 8.5 }],
  ["1-1", { outcomeId: "11", outcomeIdV2: "v11", odds: 7.0 }],
  ["2-1", { outcomeId: "21", outcomeIdV2: "v21", odds: 9.0 }],
  ["4+-4+", { outcomeId: "any", outcomeIdV2: "vany", odds: 51 }],
]);

describe("ScoreGrid", () => {
  it("renders score cells where outcomes exist", () => {
    render(
      <ScoreGrid
        homeMaxGoals={4}
        awayMaxGoals={4}
        outcomes={sampleScores}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText("11.00")).toBeInTheDocument();
    expect(screen.getByText("7.00")).toBeInTheDocument();
    expect(screen.getByText("8.50")).toBeInTheDocument();
  });

  it("renders dash for missing scores", () => {
    render(
      <ScoreGrid
        homeMaxGoals={4}
        awayMaxGoals={4}
        outcomes={sampleScores}
        onSelect={() => {}}
      />
    );
    // Total cells in 5x5 = 25, sample has 5 → 20 dashes
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(20);
  });

  it("highlights default 1-1 cell", () => {
    const { container } = render(
      <ScoreGrid
        homeMaxGoals={4}
        awayMaxGoals={4}
        outcomes={sampleScores}
        onSelect={() => {}}
      />
    );
    const highlighted = container.querySelector("[data-highlighted='true']");
    expect(highlighted).toBeTruthy();
  });

  it("supports custom highlightedScore prop", () => {
    const { container } = render(
      <ScoreGrid
        homeMaxGoals={4}
        awayMaxGoals={4}
        outcomes={sampleScores}
        highlightedScore="2-1"
        onSelect={() => {}}
      />
    );
    const highlighted = container.querySelector("[data-highlighted='true']");
    expect(highlighted?.textContent).toContain("9.00");
  });
});
