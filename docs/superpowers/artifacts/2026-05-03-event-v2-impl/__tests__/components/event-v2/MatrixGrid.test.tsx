import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MatrixGrid from "@/components/event-v2/MatrixGrid";

const sampleOutcomes = new Map([
  ["1/1", { outcomeId: "o1", outcomeIdV2: "v1", odds: 3.50, isSuspended: false }],
  ["1/X", { outcomeId: "o2", outcomeIdV2: "v2", odds: 15.0, isSuspended: false }],
  ["1/2", { outcomeId: "o3", outcomeIdV2: "v3", odds: 26.0, isSuspended: false }],
  ["X/1", { outcomeId: "o4", outcomeIdV2: "v4", odds: 5.50, isSuspended: false }],
  ["X/X", { outcomeId: "o5", outcomeIdV2: "v5", odds: 5.00, isSuspended: false }],
  ["X/2", { outcomeId: "o6", outcomeIdV2: "v6", odds: 7.50, isSuspended: false }],
  ["2/1", { outcomeId: "o7", outcomeIdV2: "v7", odds: 26.0, isSuspended: false }],
  ["2/X", { outcomeId: "o8", outcomeIdV2: "v8", odds: 19.0, isSuspended: false }],
  ["2/2", { outcomeId: "o9", outcomeIdV2: "v9", odds: 5.00, isSuspended: false }],
]);

describe("MatrixGrid", () => {
  it("renders 9 outcomes in 3x3 grid + 6 headers", () => {
    render(
      <MatrixGrid
        rowLabels={["HT 1", "HT X", "HT 2"]}
        colLabels={["Finale 1", "Finale X", "Finale 2"]}
        keyPrefix={["1", "X", "2"]}
        outcomes={sampleOutcomes}
        onSelect={() => {}}
      />
    );
    expect(screen.getAllByRole("button")).toHaveLength(9);
    expect(screen.getByText("3.50")).toBeInTheDocument();
    expect(screen.getByText("15.00")).toBeInTheDocument();
    expect(screen.getByText("HT 1")).toBeInTheDocument();
    expect(screen.getByText("Finale 2")).toBeInTheDocument();
  });

  it("missing outcome renders as dash non-clickable", () => {
    const partial = new Map(sampleOutcomes);
    partial.delete("1/X");
    render(
      <MatrixGrid
        rowLabels={["HT 1", "HT X", "HT 2"]}
        colLabels={["Finale 1", "Finale X", "Finale 2"]}
        keyPrefix={["1", "X", "2"]}
        outcomes={partial}
        onSelect={() => {}}
      />
    );
    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
