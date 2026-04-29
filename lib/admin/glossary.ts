// E8 — Admin glossary dictionary.
// Used by <GlossaryTerm term="..." /> to render technical terms with a hover
// tooltip explaining what they mean. Keeps definitions centralized so the
// whole admin panel stays self-documenting for new operators.

export interface GlossaryEntry {
  label: string;
  description: string;
  seeAlso?: string[];
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  overround: {
    label: "overround",
    description:
      "Somma delle probabilità implicite di tutti gli outcome di un mercato. Un mercato equo ha overround 100%; sopra significa margine del bookmaker.",
    seeAlso: ["implied_prob"],
  },
  implied_prob: {
    label: "implied probability",
    description:
      "Probabilità implicita di un outcome, calcolata come 1 / odds. Es: odds 2.00 → 50%.",
    seeAlso: ["overround"],
  },
  candidate_delta: {
    label: "candidate delta",
    description:
      "Differenza percentuale tra la quota di una fonte e la quota consenso calcolata sulle altre. Se > soglia, l'outcome è un outlier da rivedere.",
    seeAlso: ["consensus"],
  },
  consensus: {
    label: "consensus",
    description:
      "Quota di riferimento calcolata come mediana fra le fonti disponibili (escluso il provider valutato per evitare feedback loop).",
    seeAlso: ["candidate_delta"],
  },
  "shade-to-min": {
    label: "shade-to-min",
    description:
      "Strategia di risk management: quando una quota è outlier (candidate_delta sopra soglia e canonical_verified), la sostituisce con il minimo tra le altre fonti.",
    seeAlso: ["candidate_delta", "canonical_verified"],
  },
  extracted_by: {
    label: "extracted_by",
    description:
      "Indica quale stage della pipeline di normalizzazione ha mappato il market_type: rx (regex), dc (dictionary), xs (cross-source propagation), fz (fuzzy), ai (LLM), MAN (manuale).",
  },
  canonical_key: {
    label: "canonical_key",
    description:
      "Chiave canonica unificata di un mercato. Tutti i source_market_type equivalenti delle varie fonti puntano allo stesso canonical_key.",
    seeAlso: ["canonical_verified"],
  },
  canonical_verified: {
    label: "canonical_verified",
    description:
      "Flag booleano che indica se la mappatura source_market_type → canonical_key è stata confermata manualmente da un operatore. Solo i canonical verified guidano lo shade-to-min.",
  },
  flashscore_id: {
    label: "flashscore_id",
    description:
      "Identificatore univoco di un evento sportivo nel catalogo Flashscore (8 caratteri alfanumerici). Usato come chiave unificante tra fonti.",
  },
  match_stage: {
    label: "match_stage",
    description:
      "Stage della pipeline di Event Normalization che ha prodotto il mapping: exact, fuzzy, trigram, alias_dict, llm, manual.",
  },
  confidence: {
    label: "confidence",
    description:
      "Punteggio 0-100 che rappresenta la certezza del mapping automatico. Sotto 50 è basso, 50-85 medio, sopra 85 alto.",
  },
  outcome_key: {
    label: "outcome_key",
    description:
      "Chiave canonica di un outcome (es: home, draw, away, over, under). Si applica solo a canonical markets con schema outcome definito.",
  },
  source_market_type: {
    label: "source_market_type",
    description:
      "Stringa grezza del tipo di mercato come restituita dalla fonte (es: 'Vincente Incontro' o 'Team Total - Over/Under').",
  },
  period: {
    label: "period",
    description:
      "Porzione temporale del mercato: ft (full time), ht (half time), 1st/2nd (primo/secondo tempo), sh (second half), et (extra time), etc.",
  },
  is_suspended: {
    label: "is_suspended",
    description:
      "Flag di sospensione temporanea di un outcome lato scraper (source-level). Non conta come invalido ma invisibile al player finché torna is_suspended=false.",
  },
  manual_suspended: {
    label: "manual_suspended",
    description:
      "Override manuale di sospensione impostato dall'operatore tramite Manual Overrides. Ha priorità sul flag di scraper.",
  },
  displayed_odds: {
    label: "displayed_odds",
    description:
      "Quota effettivamente mostrata al player dopo shade-to-min + manual_override. NULL significa che l'outcome non è visibile.",
  },
};

/** Small helper for safe lookup (returns undefined if term doesn't exist). */
export function getGlossaryEntry(term: string): GlossaryEntry | undefined {
  return GLOSSARY[term];
}
