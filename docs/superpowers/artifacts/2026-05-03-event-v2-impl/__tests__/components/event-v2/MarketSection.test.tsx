import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MarketSection from "@/components/event-v2/MarketSection";

describe("MarketSection", () => {
  it("renders title and children", () => {
    render(
      <MarketSection title="GOAL / NO GOAL">
        <div>child content</div>
      </MarketSection>
    );
    expect(screen.getByText("GOAL / NO GOAL")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("renders 'altre linee' link if linkTo provided", () => {
    render(<MarketSection title="U/O 2.5" linkTo="Gol/U/O"><div /></MarketSection>);
    expect(screen.getByText(/altre linee/i)).toBeInTheDocument();
  });
});
