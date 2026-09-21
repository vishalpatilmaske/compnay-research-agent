import { findCompanyCandidates } from "./opencorporates.finder.js";
import { fetchCompany, fetchCompanyOfficers } from "./opencorporates.client.js";
import {
  normalizeCompanyNameWords,
  normalizeJurisdictionCode,
  mapCompanyDetail,
  mapOfficers,
} from "./opencorporates.mapper.js";
import { saveRawOpenCorporatesData } from "./opencorporates.store.js";

const SEARCH_URL_TEMPLATE = "https://api.opencorporates.com/v0.4/companies/search";

function companyUrl(jurisdiction, companyNumber) {
  return `https://api.opencorporates.com/v0.4/companies/${jurisdiction}/${encodeURIComponent(companyNumber)}`;
}
function officersUrl(jurisdiction, companyNumber) {
  return `${companyUrl(jurisdiction, companyNumber)}/officers`;
}

const MATCH_TYPE_BASE_SCORE = {
  name_exact_match: 3,
  name_prefix_match_close: 3,
  name_prefix_match_extended: 1,
  name_contains_match: 1,
  opencorporates_relevance_match: 0,
};

const ACTIVE_STATUS_PATTERN = /active|good standing|normal/i;

// OpenCorporates Identity Resolver: mirrors sec.adapter.js's scoreCandidate
// — distinct from opencorporates.finder.js, which only generates candidates
// from search. Scoring is additive and every point is tied to a named,
// documented piece of evidence (never a bare similarity/fuzzy score).
function scoreCandidate(candidate, detail, companyName, jurisdiction) {
  const evidence = [];
  let score = MATCH_TYPE_BASE_SCORE[candidate.matchType] ?? 0;
  evidence.push({ reason: candidate.matchType, points: score });

  const queryWords = normalizeCompanyNameWords(companyName);

  const previousNameMatch = (detail.previousNames || []).some(
    (n) => normalizeCompanyNameWords(n.name).join(" ") === queryWords.join(" "),
  );
  if (previousNameMatch) {
    evidence.push({ reason: "previous_name_exact_match", points: 1 });
    score += 1;
  }

  if (jurisdiction && detail.jurisdiction === jurisdiction) {
    evidence.push({ reason: "jurisdiction_requested_match", points: 1 });
    score += 1;
  }

  if (!detail.inactive && ACTIVE_STATUS_PATTERN.test(detail.status || "")) {
    evidence.push({ reason: "currently_registered_active", points: 1 });
    score += 1;
  }

  return { score, evidence };
}

// Fetches full company detail for each candidate (bounded by the finder's
// maxCandidates, and serialized/throttled inside opencorporates.client.js)
// and scores each one. A single candidate's fetch failing (e.g. a stale
// company_number in OC's search index) is logged and skipped, not fatal to
// the others.
async function resolveCandidates(candidates, companyName, jurisdiction) {
  const resolved = [];

  for (const candidate of candidates) {
    try {
      const raw = await fetchCompany(candidate.jurisdiction, candidate.companyNumber);
      const detail = mapCompanyDetail(raw?.results?.company);
      if (!detail) continue;

      const { score, evidence } = scoreCandidate(candidate, detail, companyName, jurisdiction);

      resolved.push({ candidate, detail, rawCompany: raw, score, evidence });
    } catch (error) {
      console.error(
        `OpenCorporates lookup failed for ${candidate.jurisdiction}/${candidate.companyNumber}:`,
        error.message,
      );
    }
  }

  return resolved.sort((a, b) => b.score - a.score);
}

// MATCHED requires both an absolute floor (score >= 2 — a bare "contains"
// or relevance-only match with zero corroboration is never enough on its
// own) and, when more than one candidate was resolved, a clear margin over
// the runner-up. Anything short of that is NEEDS_REVIEW rather than a
// guess. Mirrors sec.adapter.js's decideMatchStatus exactly.
function decideMatchStatus(resolved) {
  if (resolved.length === 0) return "UNRESOLVED";

  const [best, secondBest] = resolved;
  if (best.score < 2) return "NEEDS_REVIEW";
  if (!secondBest) return "MATCHED";
  return best.score - secondBest.score >= 2 ? "MATCHED" : "NEEDS_REVIEW";
}

function buildErrorResult(companyName, jurisdiction, companyNumber, error) {
  return {
    success: false,
    status: "ERROR",
    query: {
      companyName: companyName ?? null,
      jurisdiction: normalizeJurisdictionCode(jurisdiction) || null,
      companyNumber: companyNumber ?? null,
    },
    error: {
      code: error.ocErrorCode || "UNEXPECTED_ERROR",
      message: error.message,
    },
  };
}

// Direct jurisdiction+companyNumber override (mirrors the SEC adapter's
// `options.cik` and the MCA adapter's `options.cin`): skips search/name
// resolution entirely, since a company_number is only unique within its
// jurisdiction, both must be supplied together.
async function resolveByNumber(jurisdiction, companyNumber, companyName) {
  const normalizedJurisdiction = normalizeJurisdictionCode(jurisdiction);
  if (!normalizedJurisdiction || !companyNumber) {
    return {
      success: false,
      status: "ERROR",
      query: { companyName: companyName ?? null, jurisdiction: normalizedJurisdiction, companyNumber },
      error: {
        code: "INVALID_COMPANY_NUMBER",
        message: "Both jurisdiction and companyNumber are required for a direct override lookup.",
      },
    };
  }

  const raw = await fetchCompany(normalizedJurisdiction, companyNumber);
  const detail = mapCompanyDetail(raw?.results?.company);

  if (!detail) {
    return {
      success: false,
      status: "ERROR",
      query: { companyName: companyName ?? null, jurisdiction: normalizedJurisdiction, companyNumber },
      error: {
        code: "OC_404",
        message: `OpenCorporates has no company ${companyNumber} in jurisdiction ${normalizedJurisdiction}.`,
      },
    };
  }

  return {
    match: {
      companyName: detail.companyName,
      companyNumber: detail.companyNumber,
      jurisdiction: detail.jurisdiction,
      matchStatus: "MATCHED",
      matchScore: null,
      evidence: [{ reason: "direct_company_number_override", points: null }],
      candidates: [],
    },
    company: detail,
    rawCompany: raw,
    rawSearch: null,
  };
}

// OpenCorporates Adapter entry point. Chains: findCompanyCandidates (search)
// -> resolveCandidates (identity verification/scoring) -> decideMatchStatus,
// unless `options.companyNumber` (+ `options.jurisdiction`) is supplied,
// which bypasses resolution entirely. Never throws on a failed OpenCorporates
// request or an unresolved identity — always returns a structured result,
// per the adapter's error-handling contract (mirrors sec.adapter.js).
export async function openCorporatesAdapter(companyName, options = {}) {
  const { save = true, outputDir, includeOfficers = false } = options;
  const jurisdiction = normalizeJurisdictionCode(options.jurisdiction);

  try {
    let resolution;

    if (options.companyNumber) {
      const direct = await resolveByNumber(jurisdiction, options.companyNumber, companyName);
      if (direct.success === false) return direct;
      resolution = direct;
    } else {
      if (!companyName) throw new Error("companyName is required");

      const { candidates, raw: rawSearch } = await findCompanyCandidates(companyName, {
        jurisdiction,
        maxCandidates: options.maxCandidates,
      });

      if (candidates.length === 0) {
        resolution = {
          match: {
            companyName,
            companyNumber: null,
            jurisdiction: null,
            matchStatus: "UNRESOLVED",
            matchScore: null,
            evidence: [],
            candidates: [],
          },
          company: null,
          rawCompany: null,
          rawSearch,
        };
      } else {
        const resolved = await resolveCandidates(candidates, companyName, jurisdiction);
        const matchStatus = decideMatchStatus(resolved);
        const best = resolved[0] || null;

        resolution = {
          match: {
            companyName: matchStatus === "MATCHED" ? best.detail.companyName : companyName,
            companyNumber: matchStatus === "MATCHED" ? best.detail.companyNumber : null,
            jurisdiction: matchStatus === "MATCHED" ? best.detail.jurisdiction : null,
            matchStatus,
            matchScore: best?.score ?? null,
            evidence: best?.evidence ?? [],
            candidates: resolved.map((r) => ({
              companyName: r.detail.companyName,
              companyNumber: r.detail.companyNumber,
              jurisdiction: r.detail.jurisdiction,
              matchType: r.candidate.matchType,
              score: r.score,
              evidence: r.evidence,
            })),
          },
          company: matchStatus === "MATCHED" ? best.detail : null,
          rawCompany: matchStatus === "MATCHED" ? best.rawCompany : null,
          rawSearch,
        };
      }
    }

    const isMatched = resolution.match.matchStatus === "MATCHED";
    const matchedJurisdiction = resolution.match.jurisdiction;
    const matchedCompanyNumber = resolution.match.companyNumber;

    let officers = null;
    let rawOfficers = null;

    if (isMatched && includeOfficers) {
      try {
        rawOfficers = await fetchCompanyOfficers(matchedJurisdiction, matchedCompanyNumber);
        officers = mapOfficers(rawOfficers);
      } catch (error) {
        // Missing/unpublished officer data is expected for many
        // jurisdictions — not an adapter failure, just an empty result.
        console.error(
          `OpenCorporates officers lookup failed for ${matchedJurisdiction}/${matchedCompanyNumber}:`,
          error.message,
        );
      }
    }

    const sourceUrls = [SEARCH_URL_TEMPLATE];
    if (isMatched) sourceUrls.push(companyUrl(matchedJurisdiction, matchedCompanyNumber));
    if (rawOfficers) sourceUrls.push(officersUrl(matchedJurisdiction, matchedCompanyNumber));

    const openCorporatesData = {
      source: "opencorporates",
      query: {
        companyName: companyName ?? null,
        jurisdiction: jurisdiction || null,
        companyNumber: options.companyNumber ?? null,
      },
      match: resolution.match,
      company: resolution.company,
      officers,
      evidence: {
        source: "OpenCorporates",
        sourceUrls,
        retrievedAt: new Date().toISOString(),
      },
      raw: {
        search: resolution.rawSearch,
        company: resolution.rawCompany,
        officers: rawOfficers,
      },
    };

    const savedTo = save ? await saveRawOpenCorporatesData(openCorporatesData, outputDir) : null;

    return { ...openCorporatesData, savedTo };
  } catch (error) {
    return buildErrorResult(companyName, jurisdiction, options.companyNumber, error);
  }
}
