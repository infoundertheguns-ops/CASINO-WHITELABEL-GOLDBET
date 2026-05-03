import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HeroOutcomeRow from "@/components/event-v2/HeroOutcomeRow";
import CompactOutcomeRow from "@/components/event-v2/CompactOutcomeRow";

const outcomes = [
  { outcomeId: "1", outcomeIdV2: "v1", label: "Inter", odds: 2.05 },
  { outcomeId: "2", outcomeIdV2: "v2", label: "Pareggio", odds: 3.50 },
  { outcomeId: "3", outcomeIdV2: "v3", label: "Milan", odds: 3.40 },
];

describe("HeroOutcomeRow", () => {
  it("renders 3 buttons for 1X2", () => {
    render(<HeroOutcomeRow outcomes={outcomes} onSelect={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Inter")).toBeInTheDocument();
    expect(screen.getByText("3.40")).toBeInTheDocument();
  });

  it("uses hero size", () => {
    const { container } = render(<HeroOutcomeRow outcomes={outcomes} onSelect={() => {}} />);
    expect(container.querySelectorAll("[data-size=\"hero\"]").length).toBe(3);
  });
});

describe("CompactOutcomeRow", () => {
  it("renders N buttons compact size", () => {
    const { container } = render(<CompactOutcomeRow outcomes={outcomes.slice(0, 2)} onSelect={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(container.querySelectorAll("[data-size=\"compact\"]").length).toBe(2);
  });
});
