import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SubPillBar from "@/components/event-v2/SubPillBar";

const pills = ["1° Tempo", "2° Tempo", "Combo HT/FT"];

describe("SubPillBar", () => {
  it("renders all pills", () => {
    render(<SubPillBar pills={pills} active="Combo HT/FT" onChange={() => {}} />);
    pills.forEach(p => expect(screen.getByText(p)).toBeInTheDocument());
  });

  it("calls onChange when pill clicked", () => {
    const onChange = vi.fn();
    render(<SubPillBar pills={pills} active="Combo HT/FT" onChange={onChange} />);
    fireEvent.click(screen.getByText("1° Tempo"));
    expect(onChange).toHaveBeenCalledWith("1° Tempo");
  });

  it("active pill has data-active=\"true\"", () => {
    const { container } = render(<SubPillBar pills={pills} active="2° Tempo" onChange={() => {}} />);
    const activePill = container.querySelector("[data-active=\"true\"]");
    expect(activePill?.textContent).toBe("2° Tempo");
  });
});
