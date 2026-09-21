import { searchCompanies } from "./opencorporates.client.js";
import { normalizeCompanyNameWords, mapSearchResultCompany } from "./opencorporates.mapper.js";

const SEARCH_URL = "https://api.opencorporates.com/v0.4/companies/search";

// Word-array containment check: does `haystack` contain `needle` as a
// contiguous run of whole words? Mirrors sec.finder.js's containsWordSequence
// — deliberately not a substring test, to avoid the same class of false
// positive ("apple" wrongly matching inside "pineapple").
function containsWordSequence(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return false;

  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

function startsWithWordSequence(haystack, needle) {
  return needle.length > 0 && needle.every((word, i) => haystack[i] === word);
}

// Unlike SEC (no search API — sec.finder.js has to do a full local scan of a
// bulk file), OpenCorporates has a real full-text search endpoint that
// already handles legal-suffix/fuzzy variation server-side. We still classify
// every result it returns against our own deterministic word-sequence rules
// (same scheme as sec.finder.js) rather than trusting OC's relevance ranking
// alone, so match status decisions are always backed by a named, inspectable
// reason — never a bare similarity score.
function classifyMatch(companyName, queryWords) {
  const titleWords = normalizeCompanyNameWords(companyName);
  const queryUpper = queryWords.join(" ");

  if (titleWords.join(" ") === queryUpper) {
    return { matchType: "name_exact_match", tier: 5 };
  }

  if (startsWithWordSequence(titleWords, queryWords)) {
    // Fewer extra words = closer match. "Tesla" -> "Tesla, Inc." (1 extra,
    // generic legal suffix) is much closer than "Tesla" -> "Tesla Wind
    // Farm Holdings Ltd" (3+ extra, distinguishing words) — both start with
    // "Tesla", but treating them as equally strong evidence would be wrong
    // (mirrors the "Apple Inc." vs "Apple Hospitality REIT" case in
    // sec.finder.js). Extra-word count is an objective, countable signal.
    const extraWords = titleWords.length - queryWords.length;
    return extraWords <= 1
      ? { matchType: "name_prefix_match_close", tier: 4 }
      : { matchType: "name_prefix_match_extended", tier: 1 };
  }

  if (containsWordSequence(titleWords, queryWords)) {
    return { matchType: "name_contains_match", tier: 1 };
  }

  // OC's own full-text/fuzzy relevance surfaced this result even though it
  // shares no contiguous word sequence with the query (e.g. a trading name,
  // stemmed variant, or transliteration). Kept as a low-tier candidate for
  // visibility rather than dropped — the caller sees it in `candidates` —
  // but it can never win MATCHED on its own (see opencorporates.adapter.js).
  return { matchType: "opencorporates_relevance_match", tier: 0 };
}

// OpenCorporates has no bare "search" without a query, and no official
// candidate cap doc beyond `per_page` (max 30) — we search once at
// per_page=30 and keep the best `maxCandidates` after classification, same
// shape as sec.finder.js's findCompanyCiks.
export async function findCompanyCandidates(companyName, options = {}) {
  if (!companyName) throw new Error("companyName is required");

  const { jurisdiction = null, maxCandidates = 5 } = options;

  const raw = await searchCompanies({
    query: companyName,
    jurisdictionCode: jurisdiction || undefined,
    perPage: 30,
  });

  const queryWords = normalizeCompanyNameWords(companyName);
  const entries = raw?.results?.companies || [];

  const scored = entries
    .map((entry) => mapSearchResultCompany(entry.company))
    .filter(Boolean)
    .map((company) => {
      const { matchType, tier } = classifyMatch(company.companyName, queryWords);
      return {
        ...company,
        matchType,
        tier,
        source: "opencorporates-search",
        sourceUrl: SEARCH_URL,
      };
    });

  scored.sort((a, b) => b.tier - a.tier);

  return {
    candidates: scored.slice(0, maxCandidates).map(({ tier, ...candidate }) => candidate),
    raw,
  };
}
