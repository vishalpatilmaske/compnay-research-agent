import { findCompanyCiks } from "./sec.finder.js";
import { fetchSubmissions, fetchCompanyFacts } from "./sec.client.js";
import { normalizeCik, normalizeCompanyNameWords, mapSubmissions, mapCompanyFacts } from "./sec.mapper.js";
import { saveRawSecData } from "./sec.store.js";

const SUBMISSIONS_URL_TEMPLATE = "https://data.sec.gov/submissions/CIK{cik}.json";
const COMPANY_FACTS_URL_TEMPLATE = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json";

function submissionsUrl(cik) {
  return SUBMISSIONS_URL_TEMPLATE.replace("{cik}", cik);
}
function companyFactsUrl(cik) {
  return COMPANY_FACTS_URL_TEMPLATE.replace("{cik}", cik);
}

const MATCH_TYPE_BASE_SCORE = {
  ticker_exact_match: 3,
  title_exact_match: 3,
  title_prefix_match_close: 3,
  title_prefix_match_extended: 1,
  title_contains_match: 1,
};

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// A ticker appearing as its own whole word on the company's site (e.g. an
// investor-relations footer reading "NASDAQ: AAPL") is treated as
// corroboration; a bare substring match would risk false positives on
// short tickers.
function websiteMentionsTicker(websiteData, ticker) {
  if (!ticker) return false;
  const pattern = new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return (websiteData?.pages || []).some((page) => pattern.test(page.text || ""));
}

// SEC Identity Resolver: this is the part of the pipeline responsible for
// deciding whether a candidate CIK actually represents the requested
// company — distinct from sec.finder.js, which only generates candidates.
// Scoring is additive and every point is tied to a named, documented piece
// of evidence (never a similarity/fuzzy score), per the "never invent a
// CIK" requirement.
function scoreCandidate(candidate, mappedCompany, mappedFilings, companyName, websiteData) {
  const evidence = [];
  let score = MATCH_TYPE_BASE_SCORE[candidate.matchType] ?? 0;
  evidence.push({ reason: candidate.matchType, points: score });

  const queryWords = normalizeCompanyNameWords(companyName);

  const formerNameMatch = mappedCompany.formerNames.some(
    (f) => normalizeCompanyNameWords(f.name).join(" ") === queryWords.join(" "),
  );
  if (formerNameMatch) {
    evidence.push({ reason: "former_name_exact_match", points: 1 });
    score += 1;
  }

  if (mappedCompany.exchanges.length > 0) {
    evidence.push({ reason: "actively_exchange_listed", points: 1 });
    score += 1;
  }

  if (mappedFilings.recent.length > 0) {
    evidence.push({ reason: "has_sec_filing_history", points: 1 });
    score += 1;
  }

  if (websiteData) {
    if (websiteMentionsTicker(websiteData, candidate.ticker)) {
      evidence.push({ reason: "ticker_mentioned_on_company_website", points: 2 });
      score += 2;
    }

    const secHost = hostnameOf(mappedCompany.website) || hostnameOf(mappedCompany.investorWebsite);
    const siteHost = hostnameOf(websiteData.baseUrl);
    if (secHost && siteHost && secHost === siteHost) {
      evidence.push({ reason: "sec_website_field_matches_crawled_domain", points: 2 });
      score += 2;
    }
  }

  return { score, evidence };
}

// Fetches submissions for each candidate (bounded by the finder's
// maxCandidates, and serialized/throttled inside sec.client.js) and scores
// each one. A single candidate's fetch failing (e.g. a stale CIK in SEC's
// own bulk file) is logged and skipped, not fatal to the others.
async function resolveCandidates(candidates, companyName, websiteData) {
  const resolved = [];

  for (const candidate of candidates) {
    try {
      const raw = await fetchSubmissions(candidate.cik);
      const { company, filings } = mapSubmissions(raw);
      const { score, evidence } = scoreCandidate(candidate, company, filings, companyName, websiteData);

      resolved.push({ candidate, company, filings, rawSubmissions: raw, score, evidence });
    } catch (error) {
      console.error(`SEC submissions lookup failed for CIK ${candidate.cik}:`, error.message);
    }
  }

  return resolved.sort((a, b) => b.score - a.score);
}

// MATCHED requires both an absolute floor (score >= 2 — a bare
// "contains" match with zero corroboration is never enough on its own)
// and, when more than one candidate was resolved, a clear margin over the
// runner-up. Anything short of that is NEEDS_REVIEW rather than a guess.
function decideMatchStatus(resolved) {
  if (resolved.length === 0) return "UNRESOLVED";

  const [best, secondBest] = resolved;
  if (best.score < 2) return "NEEDS_REVIEW";
  if (!secondBest) return "MATCHED";
  return best.score - secondBest.score >= 2 ? "MATCHED" : "NEEDS_REVIEW";
}

function buildErrorResult(companyName, cik, error) {
  return {
    success: false,
    status: "ERROR",
    query: { companyName: companyName ?? null, cik: cik ?? null },
    error: {
      code: error.secErrorCode || "UNEXPECTED_ERROR",
      message: error.message,
    },
  };
}

// Direct CIK override (mirrors the MCA adapter's `options.cin`): skips name
// resolution entirely, but still validates that SEC's own response for
// this CIK actually echoes back the same CIK before trusting it.
async function resolveByCik(cik, companyName) {
  const normalized = normalizeCik(cik);
  if (!normalized) {
    return {
      success: false,
      status: "ERROR",
      query: { companyName: companyName ?? null, cik },
      error: { code: "INVALID_CIK", message: `"${cik}" is not a valid CIK.` },
    };
  }

  const raw = await fetchSubmissions(normalized);
  const { company, filings } = mapSubmissions(raw);

  if (company.cik !== normalized) {
    return {
      success: false,
      status: "ERROR",
      query: { companyName: companyName ?? null, cik: normalized },
      error: {
        code: "CIK_MISMATCH",
        message: `SEC returned CIK ${company.cik} for requested CIK ${normalized}.`,
      },
    };
  }

  return {
    match: {
      companyName: company.companyName,
      cik: normalized,
      matchStatus: "MATCHED",
      matchScore: null,
      evidence: [{ reason: "direct_cik_override", points: null }],
      candidates: [],
    },
    company,
    filings,
    rawSubmissions: raw,
  };
}

// SEC Adapter entry point. Chains: findCompanyCiks (candidates) ->
// resolveCandidates (identity verification/scoring) -> decideMatchStatus,
// unless `options.cik` is supplied, which bypasses resolution entirely.
// Never throws on a failed SEC request or an unresolved identity — always
// returns a structured result, per the adapter's error-handling contract.
export async function secAdapter(companyName, options = {}) {
  const { save = true, outputDir, includeFacts = false, websiteData = null } = options;

  try {
    let resolution;

    if (options.cik) {
      const direct = await resolveByCik(options.cik, companyName);
      if (direct.success === false) return direct;
      resolution = direct;
    } else {
      if (!companyName) throw new Error("companyName is required");

      const candidates = await findCompanyCiks(companyName, options);

      if (candidates.length === 0) {
        resolution = {
          match: {
            companyName,
            cik: null,
            matchStatus: "UNRESOLVED",
            matchScore: null,
            evidence: [],
            candidates: [],
          },
          company: null,
          filings: null,
          rawSubmissions: null,
        };
      } else {
        const resolved = await resolveCandidates(candidates, companyName, websiteData);
        const matchStatus = decideMatchStatus(resolved);
        const best = resolved[0] || null;

        resolution = {
          match: {
            companyName: matchStatus === "MATCHED" ? best.company.companyName : companyName,
            cik: matchStatus === "MATCHED" ? best.company.cik : null,
            matchStatus,
            matchScore: best?.score ?? null,
            evidence: best?.evidence ?? [],
            candidates: resolved.map((r) => ({
              cik: r.company.cik,
              companyName: r.company.companyName,
              ticker: r.candidate.ticker,
              score: r.score,
              evidence: r.evidence,
            })),
          },
          company: matchStatus === "MATCHED" ? best.company : null,
          filings: matchStatus === "MATCHED" ? best.filings : null,
          rawSubmissions: matchStatus === "MATCHED" ? best.rawSubmissions : null,
        };
      }
    }

    const isMatched = resolution.match.matchStatus === "MATCHED";
    const cik = resolution.match.cik;

    let financialFacts = null;
    let rawCompanyFacts = null;

    if (isMatched && includeFacts) {
      try {
        rawCompanyFacts = await fetchCompanyFacts(cik);
        financialFacts = mapCompanyFacts(rawCompanyFacts);
      } catch (error) {
        // Missing XBRL facts (SEC_404) is expected for many filers — not
        // an adapter failure, just an empty result.
        console.error(`SEC company facts lookup failed for CIK ${cik}:`, error.message);
      }
    }

    const sourceUrls = ["https://www.sec.gov/files/company_tickers.json"];
    if (isMatched) sourceUrls.push(submissionsUrl(cik));
    if (rawCompanyFacts) sourceUrls.push(companyFactsUrl(cik));

    const secData = {
      source: "sec",
      query: { companyName: companyName ?? null, cik: options.cik ? normalizeCik(options.cik) : null },
      match: resolution.match,
      company: resolution.company,
      filings: resolution.filings,
      financialFacts,
      evidence: {
        source: "SEC",
        sourceUrls,
        retrievedAt: new Date().toISOString(),
      },
      raw: {
        submissions: resolution.rawSubmissions,
        companyFacts: rawCompanyFacts,
      },
    };

    const savedTo = save ? await saveRawSecData(secData, outputDir) : null;

    return { ...secData, savedTo };
  } catch (error) {
    return buildErrorResult(companyName, options.cik, error);
  }
}
