import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TabBar from "@/components/event-v2/TabBar";

const tabs = ["Principali", "Gol/U/O", "Handicap", "Tempi", "Player", "Stats"];

describe("TabBar", () => {
  it("renders all tabs", () => {
    render(<TabBar tabs={tabs} activeTab="Principali" onChange={() => {}} />);
    tabs.forEach(tab => {
      expect(screen.getByText(tab)).toBeInTheDocument();
    });
  });

  it("calls onChange when inactive tab clicked", () => {
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} activeTab="Principali" onChange={onChange} />);
    fireEvent.click(screen.getByText("Player"));
    expect(onChange).toHaveBeenCalledWith("Player");
  });

  it("active tab has data-active=\"true\" attr", () => {
    const { container } = render(<TabBar tabs={tabs} activeTab="Tempi" onChange={() => {}} />);
    const activeBtn = container.querySelector("[data-active=\"true\"]");
    expect(activeBtn?.textContent).toBe("Tempi");
  });
});
