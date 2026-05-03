import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LinePicker from "@/components/event-v2/LinePicker";

const mkVariant = (line: number, underOdds: number, overOdds: number) => ({
  line,
  marketId: `m${line}`,
  marketIdV2: `v${line}`,
  outcomes: [
    { outcomeId: `u${line}`, outcomeIdV2: `vu${line}`, name: "Under", odds: underOdds },
    { outcomeId: `o${line}`, outcomeIdV2: `vo${line}`, name: "Over", odds: overOdds },
  ],
});

describe("LinePicker", () => {
  it("default line shown highlighted with star marker", () => {
    const variants = [mkVariant(1.5, 1.10, 7.50), mkVariant(2.5, 1.85, 1.95), mkVariant(3.5, 2.50, 1.55)];
    render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    expect(screen.getByText(/2\.5.*★/)).toBeInTheDocument();
  });

  it("falls back to closest if default line missing", () => {
    const variants = [mkVariant(2.0, 1.5, 2.5), mkVariant(3.0, 2.5, 1.5)];
    render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    expect(screen.getByText(/2.*★/)).toBeInTheDocument();
  });

  it("shows top 3 (default + 1 below + 1 above)", () => {
    const variants = [mkVariant(1.5, 1.10, 7.50), mkVariant(2.5, 1.85, 1.95), mkVariant(2.75, 2.05, 1.78), mkVariant(3.5, 2.50, 1.55), mkVariant(4.5, 4.00, 1.25)];
    const { container } = render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    const visibleLines = container.querySelectorAll("[data-line]");
    expect(visibleLines).toHaveLength(3);
  });

  it("expand button shows remaining variants", () => {
    const variants = [mkVariant(1.5, 1.10, 7.50), mkVariant(2.5, 1.85, 1.95), mkVariant(2.75, 2.05, 1.78), mkVariant(3.5, 2.50, 1.55), mkVariant(4.5, 4.00, 1.25)];
    render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    expect(screen.getByText(/altre 2 linee/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/altre 2 linee/i));
    expect(screen.queryByText(/altre/i)).not.toBeInTheDocument();
  });

  it("with 1 variant, no expand", () => {
    const variants = [mkVariant(2.5, 1.85, 1.95)];
    const { container } = render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    expect(screen.queryByText(/altre/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-line]")).toHaveLength(1);
  });
});
