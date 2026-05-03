import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EuropeanHandicapBlock from "@/components/event-v2/EuropeanHandicapBlock";

const mkEUVariant = (line: number) => ({
  line,
  marketId: `m${line}`,
  marketIdV2: `v${line}`,
  outcomes: [
    { outcomeId: `1${line}`, outcomeIdV2: `v1${line}`, name: "1", odds: 3.5 },
    { outcomeId: `x${line}`, outcomeIdV2: `vx${line}`, name: "X", odds: 3.4 },
    { outcomeId: `2${line}`, outcomeIdV2: `v2${line}`, name: "2", odds: 2.1 },
  ],
});

describe("EuropeanHandicapBlock", () => {
  it("renders 3 outcome buttons + chip picker", () => {
    const variants = [mkEUVariant(-2), mkEUVariant(-1), mkEUVariant(1), mkEUVariant(2)];
    const { container } = render(<EuropeanHandicapBlock variants={variants} onSelect={() => {}} />);
    // 3 outcome buttons (1/X/2) for the active variant — identified by data-size="standard"
    expect(container.querySelectorAll('button[data-size="standard"]')).toHaveLength(3);
    // 4 chip buttons (one per line)
    expect(screen.getByText("−2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("default active chip is -1", () => {
    const variants = [mkEUVariant(-2), mkEUVariant(-1), mkEUVariant(1), mkEUVariant(2)];
    const { container } = render(<EuropeanHandicapBlock variants={variants} onSelect={() => {}} />);
    expect(container.querySelector("[data-active-chip='true'][data-line='-1']")).toBeTruthy();
  });

  it("clicking chip changes active variant", () => {
    const variants = [mkEUVariant(-2), mkEUVariant(-1), mkEUVariant(1)];
    const { container } = render(<EuropeanHandicapBlock variants={variants} onSelect={() => {}} />);
    fireEvent.click(screen.getByText("+1"));
    expect(container.querySelector("[data-active-chip='true'][data-line='1']")).toBeTruthy();
  });

  it("falls back to closest if -1 missing", () => {
    const variants = [mkEUVariant(-3), mkEUVariant(2)];
    const { container } = render(<EuropeanHandicapBlock variants={variants} onSelect={() => {}} />);
    // Closest to -1: |-3-(-1)|=2, |2-(-1)|=3 → -3 wins
    expect(container.querySelector("[data-active-chip='true'][data-line='-3']")).toBeTruthy();
  });

  it("returns null with no variants", () => {
    const { container } = render(<EuropeanHandicapBlock variants={[]} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
