"use client";

import React from "react";
import { getGlossaryEntry } from "@/lib/admin/glossary";

// E8 — GlossaryTerm renders an inline technical term with a hover tooltip.
// The tooltip pulls its description from lib/admin/glossary.ts so definitions
// stay centralized. Screen readers get the full definition via aria-label.

export function GlossaryTerm({ term, children }: { term: string; children?: React.ReactNode }) {
  const entry = getGlossaryEntry(term);
  const display = children ?? entry?.label ?? term;

  if (!entry) {
    // Fallback: just render the term un-styled (no definition known).
    return <span>{display}</span>;
  }

  const aria = `${entry.label}: ${entry.description}`;
  return (
    <abbr
      title={entry.description}
      aria-label={aria}
      style={{
        textDecoration: "underline dotted",
        textDecorationColor: "#8b5cf680",
        textUnderlineOffset: 3,
        cursor: "help",
      }}
    >
      {display}
    </abbr>
  );
}
