import { findCompanies } from "./companiesHouse.finder.js";
import { fetchCompanyProfile, fetchCompanyOfficers } from "./companiesHouse.client.js";
import { mapCompanyProfile, mapOfficers } from "./companiesHouse.mapper.js";
import { saveRawCompaniesHouseData } from "./companiesHouse.store.js";

const MATCH_TYPE_BASE_SCORE = {
  title_exact_match: 3,
  title_prefix_match_close: 3,
  title_prefix_match_extended: 1,
  title_contains_match: 1,
};

// Deterministic, evidence-tagged scoring — mirrors sec.adapter.js's
// scoreCandidate() exactly, for the same reason: every point is tied to a
// named, documented signal, never a fuzzy similarity guess.
function scoreCandidate(candidate) {
  const evidence = [];
  let score = MATCH_TYPE_BASE_SCORE[candidate.matchType] ?? 0;
  evidence.push({ reason: candidate.matchType, points: score });

  if ((candidate.companyStatus || "").toLowerCase() === "active") {
    evidence.push({ reason: "company_status_active", points: 1 });
    score += 1;
  }

  return { score, evidence };
}

// Same floor-plus-margin rule as sec.adapter.js's decideMatchStatus.
function decideMatchStatus(resolved) {
  if (resolved.length === 0) return "UNRESOLVED";
  const [best, secondBest] = resolved;
  if (best.score < 2) return "NEEDS_REVIEW";
  if (!secondBest) return "MATCHED";
  return best.score - secondBest.score >= 2 ? "MATCHED" : "NEEDS_REVIEW";
}

function buildErrorResult(companyName, companyNumber, error) {
  return {
    success: false,
    status: "ERROR",
    query: { companyName: companyName ?? null, companyNumber: companyNumber ?? null },
    error: { code: error.companiesHouseErrorCode || "UNEXPECTED_ERROR", message: error.message },
  };
}

// Direct company-number override, mirroring sec.adapter's resolveByCik.
async function resolveByCompanyNumber(companyNumber, companyName) {
  const raw = await fetchCompanyProfile(companyNumber);
  const company = mapCompanyProfile(raw);

  return {
    match: {
      companyName: company.companyName,
      companyNumber,
      matchStatus: "MATCHED",
      matchScore: null,
      evidence: [{ reason: "direct_company_number_override", points: null }],
      candidates: [],
    },
    company,
    rawProfile: raw,
  };
}

// Companies House Adapter entry point. Chains findCompanies (candidates) ->
// scoreCandidate/decideMatchStatus (identity verification), unless
// `options.companyNumber` is supplied, which bypasses resolution entirely —
// same shape and conventions as secAdapter. Never throws to the caller:
// a missing API key or a failed lookup both come back as a structured
// result, distinguished by `status` ("NOT_CONFIGURED" vs "ERROR") so the
// leadership orchestrator can treat "we didn't check" differently from
// "we checked and it failed".
export async function companiesHouseAdapter(companyName, options = {}) {
  const { save = true, outputDir } = options;

  if (!process.env.COMPANIES_HOUSE_API_KEY) {
    return {
      success: false,
      status: "NOT_CONFIGURED",
      query: { companyName: companyName ?? null, companyNumber: options.companyNumber ?? null },
      error: {
        code: "NOT_CONFIGURED",
        message:
          "COMPANIES_HOUSE_API_KEY is not set — Companies House was skipped, not treated as a failed lookup. " +
          "Get a free key from https://developer.company-information.service.gov.uk/ to enable it.",
      },
    };
  }

  try {
    let resolution;

    if (options.companyNumber) {
      resolution = await resolveByCompanyNumber(options.companyNumber, companyName);
    } else {
      if (!companyName) throw new Error("companyName is required");

      const candidates = await findCompanies(companyName, options);

      if (candidates.length === 0) {
        resolution = {
          match: {
            companyName,
            companyNumber: null,
            matchStatus: "UNRESOLVED",
            matchScore: null,
            evidence: [],
            candidates: [],
          },
          company: null,
          rawProfile: null,
        };
      } else {
        const resolved = candidates
          .map((candidate) => ({ candidate, ...scoreCandidate(candidate) }))
          .sort((a, b) => b.score - a.score);

        const matchStatus = decideMatchStatus(resolved);
        const best = resolved[0];

        let bestCompany = null;
        let bestRawProfile = null;
        if (matchStatus === "MATCHED") {
          bestRawProfile = await fetchCompanyProfile(best.candidate.companyNumber);
          bestCompany = mapCompanyProfile(bestRawProfile);
        }

        resolution = {
          match: {
            companyName: matchStatus === "MATCHED" ? bestCompany.companyName : companyName,
            companyNumber: matchStatus === "MATCHED" ? best.candidate.companyNumber : null,
            matchStatus,
            matchScore: best.score,
            evidence: best.evidence,
            candidates: resolved.map((r) => ({
              companyNumber: r.candidate.companyNumber,
              title: r.candidate.title,
              companyStatus: r.candidate.companyStatus,
              score: r.score,
              evidence: r.evidence,
            })),
          },
          company: bestCompany,
          rawProfile: bestRawProfile,
        };
      }
    }

    const isMatched = resolution.match.matchStatus === "MATCHED";
    const companyNumber = resolution.match.companyNumber;

    let officers = null;
    let rawOfficers = null;
    if (isMatched) {
      try {
        rawOfficers = await fetchCompanyOfficers(companyNumber);
        officers = mapOfficers(rawOfficers);
      } catch (error) {
        // A profile match with no fetchable officer list is still a useful
        // identity result — not fatal to the whole lookup.
        console.error(`Companies House officers lookup failed for ${companyNumber}:`, error.message);
      }
    }

    const sourceUrls = [];
    if (isMatched) {
      sourceUrls.push(
        `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}`,
        `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/officers`,
      );
    }

    const companiesHouseData = {
      source: "companies_house",
      query: { companyName: companyName ?? null, companyNumber: options.companyNumber ?? null },
      match: resolution.match,
      company: resolution.company,
      officers,
      evidence: {
        source: "Companies House",
        sourceUrls,
        retrievedAt: new Date().toISOString(),
      },
      raw: {
        profile: resolution.rawProfile,
        officers: rawOfficers,
      },
    };

    const savedTo = save ? await saveRawCompaniesHouseData(companiesHouseData, outputDir) : null;

    return { ...companiesHouseData, savedTo };
  } catch (error) {
    return buildErrorResult(companyName, options.companyNumber, error);
  }
}
