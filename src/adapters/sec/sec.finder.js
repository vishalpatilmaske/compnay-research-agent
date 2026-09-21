import { fetchCompanyTickers } from "./sec.client.js";
import { normalizeCik, normalizeCompanyNameWords } from "./sec.mapper.js";

const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

// Word-array containment check: does `haystack` contain `needle` as a
// contiguous run of whole words? Deliberately not a substring test — a raw
// substring match on "apple" wrongly matches "Maui Land & PINEAPPLE Co
// Inc" (confirmed against the live company_tickers.json data), because
// "pineapple" contains the letters "apple". Matching whole words only
// avoids that class of false positive entirely.
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

// SEC has no fuzzy/partial company-name search API — the closest official
// mechanism is this bulk ticker/CIK/name registry (~10k entries), refreshed
// periodically by SEC and cached by sec.client.js. Every candidate here is
// backed by a documented match type against that registry; nothing is
// guessed or scored by similarity heuristics.
export async function findCompanyCiks(companyName, { maxCandidates = 5 } = {}) {
  if (!companyName) throw new Error("companyName is required");

  const entries = await fetchCompanyTickers();
  const queryWords = normalizeCompanyNameWords(companyName);
  const queryUpper = companyName.trim().toUpperCase();

  const scored = [];

  for (const entry of entries) {
    const titleWords = normalizeCompanyNameWords(entry.title);

    let matchType = null;
    let tier = 0;

    if (entry.ticker && entry.ticker.toUpperCase() === queryUpper) {
      matchType = "ticker_exact_match";
      tier = 5;
    } else if (titleWords.join(" ") === queryWords.join(" ")) {
      matchType = "title_exact_match";
      tier = 5;
    } else if (startsWithWordSequence(titleWords, queryWords)) {
      // "Apple" is a much closer match to "Apple Inc." (1 extra word, a
      // generic legal suffix) than to "Apple Hospitality REIT, Inc." (3
      // extra, distinguishing words) — both start with "Apple", but
      // treating them as equally strong evidence is what caused a false
      // 3-way tie in testing (Apple Inc. / Apple Hospitality REIT / Apple
      // iSports Group all start with "Apple" and were otherwise scored
      // identically). Extra-word count is an objective, countable signal,
      // not a fuzzy similarity guess.
      const extraWords = titleWords.length - queryWords.length;
      matchType = extraWords <= 1 ? "title_prefix_match_close" : "title_prefix_match_extended";
      tier = extraWords <= 1 ? 4 : 1;
    } else if (containsWordSequence(titleWords, queryWords)) {
      matchType = "title_contains_match";
      tier = 1;
    }

    if (matchType) {
      scored.push({
        cik: normalizeCik(entry.cik_str),
        ticker: entry.ticker,
        title: entry.title,
        matchType,
        tier,
        source: "sec-company-tickers",
        sourceUrl: COMPANY_TICKERS_URL,
      });
    }
  }

  scored.sort((a, b) => b.tier - a.tier);

  return scored.slice(0, maxCandidates).map(({ tier, ...candidate }) => candidate);
}
