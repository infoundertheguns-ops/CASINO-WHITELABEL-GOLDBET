import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PlayerListFlat from "@/components/event-v2/PlayerListFlat";

const players = Array.from({ length: 25 }, (_, i) => ({
  outcomeId: `o${i}`,
  outcomeIdV2: `v${i}`,
  playerName: `Player ${i}`,
  odds: 1.5 + i * 0.5,
  isSuspended: false,
}));

describe("PlayerListFlat", () => {
  it("renders top 10 by default with expand button when >10", () => {
    render(<PlayerListFlat players={players} onSelect={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeLessThanOrEqual(11);
    expect(screen.getByText(/Mostra tutti.*15/i)).toBeInTheDocument();
  });

  it("expand reveals all players", () => {
    render(<PlayerListFlat players={players} onSelect={() => {}} />);
    fireEvent.click(screen.getByText(/Mostra tutti/i));
    expect(screen.getAllByRole("button").length).toBe(25);
  });

  it("with <=10 players, no expand button", () => {
    const few = players.slice(0, 5);
    render(<PlayerListFlat players={few} onSelect={() => {}} />);
    expect(screen.queryByText(/Mostra tutti/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBe(5);
  });

  it("sorts by odds ascending (favorites top)", () => {
    const shuffled = [
      { outcomeId: "p3", outcomeIdV2: "v3", playerName: "Player 3", odds: 3.0, isSuspended: false },
      { outcomeId: "p1", outcomeIdV2: "v1", playerName: "Player 1", odds: 1.0, isSuspended: false },
      { outcomeId: "p2", outcomeIdV2: "v2", playerName: "Player 2", odds: 2.0, isSuspended: false },
    ];
    render(<PlayerListFlat players={shuffled} onSelect={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].textContent).toContain("Player 1");
    expect(buttons[0].textContent).toContain("1.00");
  });
});
