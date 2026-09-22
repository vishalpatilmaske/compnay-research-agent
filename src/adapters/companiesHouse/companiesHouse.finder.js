import { searchCompanies } from "./companiesHouse.client.js";
import { mapSearchResult } from "./companiesHouse.mapper.js";

function toWords(name) {
  return (name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function startsWithWordSequence(haystack, needle) {
  return needle.length > 0 && needle.every((word, i) => haystack[i] === word);
}

// Same word-sequence-containment approach as sec.finder.js's
// containsWordSequence, for the same reason: a raw substring match risks
// false positives a whole-word match doesn't.
function containsWordSequence(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

// Companies House's /search/companies is a real (if basic) fuzzy search —
// unlike SEC's static ticker file, results are already somewhat ranked by
// their API. This still re-scores every candidate deterministically rather
// than trusting result order alone, exactly like sec.finder.js does for its
// own source.
export async function findCompanies(companyName, { maxCandidates = 5 } = {}) {
  if (!companyName) throw new Error("companyName is required");

  const raw = await searchCompanies(companyName, { itemsPerPage: maxCandidates * 3 });
  const items = (raw.items || []).map(mapSearchResult);

  const queryWords = toWords(companyName);

  const scored = items.map((item, apiRank) => {
    const titleWords = toWords(item.title);

    let matchType = null;
    let tier = 0;

    if (titleWords.join(" ") === queryWords.join(" ")) {
      matchType = "title_exact_match";
      tier = 5;
    } else if (startsWithWordSequence(titleWords, queryWords)) {
      const extraWords = titleWords.length - queryWords.length;
      matchType = extraWords <= 1 ? "title_prefix_match_close" : "title_prefix_match_extended";
      tier = extraWords <= 1 ? 4 : 1;
    } else if (containsWordSequence(titleWords, queryWords)) {
      matchType = "title_contains_match";
      tier = 1;
    }

    // The API's own ranking is used only as a tiebreaker within an
    // identical word-match tier, never to override it.
    return { ...item, matchType, tier, apiRank };
  });

  return scored
    .filter((c) => c.matchType)
    .sort((a, b) => b.tier - a.tier || a.apiRank - b.apiRank)
    .slice(0, maxCandidates)
    .map(({ tier, apiRank, ...candidate }) => candidate);
}
