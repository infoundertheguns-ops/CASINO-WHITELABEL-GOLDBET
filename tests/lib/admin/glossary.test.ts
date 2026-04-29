import { describe, it, expect } from "vitest";
import { GLOSSARY, getGlossaryEntry } from "@/lib/admin/glossary";

describe("glossary dictionary", () => {
  it("every entry has label + non-empty description", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.label, `${key}.label must be non-empty`).toBeTruthy();
      expect(entry.description.length, `${key}.description must be non-empty`).toBeGreaterThan(10);
    }
  });

  it("seeAlso references point to existing entries", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      for (const ref of entry.seeAlso ?? []) {
        expect(GLOSSARY[ref], `${key}.seeAlso references unknown term "${ref}"`).toBeTruthy();
      }
    }
  });

  it("getGlossaryEntry returns the entry when term is known", () => {
    const e = getGlossaryEntry("canonical_key");
    expect(e).toBeTruthy();
    expect(e?.label).toBe("canonical_key");
  });

  it("getGlossaryEntry returns undefined for unknown term", () => {
    expect(getGlossaryEntry("does_not_exist_xyz")).toBeUndefined();
  });

  it("covers the core Phase B/C + shade terms", () => {
    for (const term of [
      "canonical_key",
      "canonical_verified",
      "shade-to-min",
      "candidate_delta",
      "consensus",
      "flashscore_id",
      "extracted_by",
      "displayed_odds",
    ]) {
      expect(GLOSSARY[term], `missing required glossary term: ${term}`).toBeTruthy();
    }
  });
});
