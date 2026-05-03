import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OutcomeButton from "@/components/event-v2/OutcomeButton";

const baseProps = {
  outcomeId: "leg1",
  outcomeIdV2: "v2leg1",
  label: "Inter",
  odds: 1.85,
  isSuspended: false,
  isManualSuspended: false,
  oddsChange: null,
  size: "standard" as const,
  onSelect: vi.fn(),
};

describe("OutcomeButton", () => {
  it("renders label and odds", () => {
    render(<OutcomeButton {...baseProps} />);
    expect(screen.getByText("Inter")).toBeInTheDocument();
    expect(screen.getByText("1.85")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<OutcomeButton {...baseProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("does not call onSelect when suspended", () => {
    const onSelect = vi.fn();
    render(<OutcomeButton {...baseProps} isSuspended={true} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders lock icon when suspended", () => {
    render(<OutcomeButton {...baseProps} isSuspended={true} />);
    expect(screen.getByTestId("lock-icon")).toBeInTheDocument();
  });

  it("applies hero size class", () => {
    const { container } = render(<OutcomeButton {...baseProps} size="hero" />);
    expect(container.querySelector("[data-size='hero']")).toBeTruthy();
  });
});
