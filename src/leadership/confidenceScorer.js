// Deterministic confidence rules. The LLM never assigns evidence_strength or
// confidence directly — it only tags claim_explicitness (a semantic-
// interpretation judgment about how directly the source text supports a
// claim), and everything from there is a fixed lookup/threshold, documented
// below, mirroring how sec.adapter.js's scoreCandidate() documents its
// scoring. This is an internal evidence-quality assessment, not a
// probability or a mathematical guarantee.

// wikidata is capped at "medium" even for structured_data — per spec,
// Wikidata is enrichment only and must never alone be enough for "high".
const STRENGTH_TABLE = {
  structured_data: {
    official_company: "high",
    sec: "high",
    companies_house: "high",
    government: "high",
    wikidata: "medium",
    news: "medium",
    search: "medium",
  },
  explicit_statement: {
    official_company: "high",
    sec: "high",
    companies_house: "high",
    government: "high",
    news: "medium",
    wikidata: "medium",
    search: "medium",
  },
  title_mention: {
    official_company: "medium",
    sec: "medium",
    companies_house: "medium",
    government: "medium",
    news: "low",
    wikidata: "low",
    search: "low",
  },
  inferred: {
    // Any source, inferred rather than stated, is weak evidence.
    default: "low",
  },
};

export function evidenceStrengthFor(sourceType, explicitness) {
  const row = STRENGTH_TABLE[explicitness] || STRENGTH_TABLE.inferred;
  return row[sourceType] || row.default || "low";
}

const STRONG_SOURCE_TYPES = new Set(["official_company", "sec", "companies_house", "government"]);

// Person-level confidence rules, evaluated in order — first match wins:
//
//   high:      >=2 independent source_types AND at least one is a strong
//              source_type (official_company/sec/companies_house/government)
//              AND no unresolved conflict for this person's primary role
//   medium:    (>=1 strong source_type, no conflict) OR
//              (>=2 independent source_types of any kind, no conflict)
//   low:       >=1 source_type at all, no conflict
//   uncertain: an unresolved conflict, or no evidence at all
//
// "independent source_types" counts distinct source_type values, not raw
// evidence items — three quotes from the same company_website page are one
// independent source, not three.
export function personConfidence(evidenceList, { hasConflict } = {}) {
  if (hasConflict) return "uncertain";
  if (!evidenceList || evidenceList.length === 0) return "uncertain";

  const sourceTypes = new Set(evidenceList.map((e) => e.source_type));
  const hasStrongSource = evidenceList.some((e) => STRONG_SOURCE_TYPES.has(e.source_type));

  if (sourceTypes.size >= 2 && hasStrongSource) return "high";
  if (hasStrongSource) return "medium";
  if (sourceTypes.size >= 2) return "medium";
  return "low";
}
