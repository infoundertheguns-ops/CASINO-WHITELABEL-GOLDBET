import { describe, it, expect, vi } from "vitest";
import { lookupLLM, MAX_LLM_CONFIDENCE } from "@/lib/normalize/llm";
import type { CanonicalMarket } from "@/lib/normalize/types";

const CANONICALS: CanonicalMarket[] = [
  { canonical_key: "1x2_ft", base_key: "1x2", period: "ft", canonical_name_it: "1X2", has_line: false, outcomes: [] },
  { canonical_key: "u_o_ft", base_key: "u_o", period: "ft", canonical_name_it: "Under/Over", has_line: true, outcomes: [] },
  { canonical_key: "total_3way_ft", base_key: "total_3way", period: "ft", canonical_name_it: "Totale 3-Way", has_line: true, outcomes: [] },
];

function mockAnthropicResponse(matches: any[]) {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({ matches }) }],
      usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 2000 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("lookupLLM", () => {
  it("returns empty result for empty batch without calling API", async () => {
    const mockFetch = vi.fn();
    const res = await lookupLLM({ batch: [], canonicals: CANONICALS, source: "odds-api", apiKey: "sk-test" }, mockFetch as any);
    expect(res.matches).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("parses a valid response and preserves matches", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockAnthropicResponse([
        { input: "1X2", canonical_key: "1x2_ft", canonical_line: null, confidence: 80, reasoning: "standard 1X2 market" },
        { input: "U/O 2.5", canonical_key: "u_o_ft", canonical_line: 2.5, confidence: 75, reasoning: "Over/Under 2.5 goals" },
      ]),
    );
    const res = await lookupLLM({ batch: ["1X2", "U/O 2.5"], canonicals: CANONICALS, source: "odds-api", apiKey: "sk-test" }, mockFetch as any);
    expect(res.matches).toHaveLength(2);
    expect(res.matches[0]).toMatchObject({ input: "1X2", canonical_key: "1x2_ft", confidence: 80 });
    expect(res.matches[1]).toMatchObject({ input: "U/O 2.5", canonical_key: "u_o_ft", canonical_line: 2.5 });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("rejects hallucinated canonical_key not in catalog", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockAnthropicResponse([
        { input: "Mercato Strano", canonical_key: "invented_canonical_ft", confidence: 70, reasoning: "guessed" },
      ]),
    );
    const res = await lookupLLM({ batch: ["Mercato Strano"], canonicals: CANONICALS, source: "odds-api", apiKey: "sk-test" }, mockFetch as any);
    expect(res.matches[0].canonical_key).toBeNull();
    expect(res.matches[0].confidence).toBe(0);
    expect(res.matches[0].reasoning).toContain("hallucinated");
  });

  it("caps confidence at MAX_LLM_CONFIDENCE", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockAnthropicResponse([
        { input: "1X2", canonical_key: "1x2_ft", confidence: 99, reasoning: "sure" },
      ]),
    );
    const res = await lookupLLM({ batch: ["1X2"], canonicals: CANONICALS, source: "odds-api", apiKey: "sk-test" }, mockFetch as any);
    expect(res.matches[0].confidence).toBe(MAX_LLM_CONFIDENCE);
  });

  it("strips markdown fencing from response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: '```json\n{"matches":[{"input":"1X2","canonical_key":"1x2_ft","confidence":70}]}\n```' }],
        }),
        { status: 200 },
      ),
    );
    const res = await lookupLLM({ batch: ["1X2"], canonicals: CANONICALS, source: "odds-api", apiKey: "sk-test" }, mockFetch as any);
    expect(res.matches[0].canonical_key).toBe("1x2_ft");
  });

  it("throws on non-JSON response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "not JSON at all" }] }),
        { status: 200 },
      ),
    );
    await expect(
      lookupLLM({ batch: ["x"], canonicals: CANONICALS, source: "odds-api", apiKey: "sk-test" }, mockFetch as any),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("throws on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(
      lookupLLM({ batch: ["x"], canonicals: CANONICALS, source: "odds-api", apiKey: "sk-test" }, mockFetch as any),
    ).rejects.toThrow(/LLM HTTP 429/);
  });

  it("throws when apiKey is missing", async () => {
    await expect(
      lookupLLM({ batch: ["x"], canonicals: CANONICALS, source: "odds-api", apiKey: "" } as any),
    ).rejects.toThrow(/apiKey is required/);
  });

  it("handles null canonical_key (no-match) correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockAnthropicResponse([
        { input: "Segna Mario Rossi", canonical_key: null, canonical_line: null, confidence: 0, reasoning: "player prop, no canonical" },
      ]),
    );
    const res = await lookupLLM({ batch: ["Segna Mario Rossi"], canonicals: CANONICALS, source: "flashscore", apiKey: "sk-test" }, mockFetch as any);
    expect(res.matches[0].canonical_key).toBeNull();
    expect(res.matches[0].confidence).toBe(0);
    expect(res.matches[0].canonical_line).toBeNull();
  });

  it("forwards cache_control in the API request body", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockAnthropicResponse([]));
    await lookupLLM({ batch: ["1X2"], canonicals: CANONICALS, source: "odds-api", apiKey: "sk-test" }, mockFetch as any);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});
