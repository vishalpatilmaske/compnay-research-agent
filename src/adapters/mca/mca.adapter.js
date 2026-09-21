import {
  findCompanyCins,
  findCinFromWebsite,
  findLegalNameFromWebsite,
  findAddressSnippetFromWebsite,
  extractPincodes,
  extractPincodesFromWebsite,
} from "./mca.finder.js";
import { queryCompanyMasterData } from "./mca.client.js";
import { mapMcaRecord } from "./mca.mapper.js";
import { saveRawMcaData } from "./mca.store.js";
import { websiteAdapter } from "../website/website.adapter.js";

function resolveResourceIds(options) {
  const configured =
    options.resourceIds ||
    process.env.DATA_GOV_MCA_RESOURCE_IDS ||
    process.env.DATA_GOV_MCA_RESOURCE_ID ||
    "";

  const ids = Array.isArray(configured)
    ? configured
    : configured.split(",").map((id) => id.trim()).filter(Boolean);

  if (ids.length === 0) {
    throw new Error(
      "No data.gov.in Company Master Data resource id configured. Set DATA_GOV_MCA_RESOURCE_IDS " +
        "(comma-separated) or DATA_GOV_MCA_RESOURCE_ID in .env.",
    );
  }

  return ids;
}

// Stage 1: resolve a casual company name (e.g. "Optimus BT") to candidate
// CIN(s). data.gov.in has no fuzzy name search, so this step is required
// before any lookup against it. When the caller has already crawled the
// company's own website (`options.websiteData`, the Website Adapter's
// result), that's checked first: a CIN the company publishes itself
// outranks anything inferred from web search, and if only a legal entity
// name is published there (no CIN), that name is used as the search query
// instead of the casual input — e.g. "Optimus BT" -> "OptimusBT Software
// India Private Limited". Falls back to plain web search otherwise.
export async function findCompany(companyName, options = {}) {
  if (!companyName) throw new Error("companyName is required");

  if (options.websiteData) {
    const websiteCin = findCinFromWebsite(options.websiteData);
    if (websiteCin) return [websiteCin];
  }

  const legalNameHit = options.websiteData ? findLegalNameFromWebsite(options.websiteData) : null;

  // Real address text published on the company's own site (e.g. its
  // Contact page) sharply narrows the search when the brand name alone is
  // ambiguous — it was the difference between surfacing the right entity
  // and not, for a brand with several similarly-named but unrelated MCA
  // registrations. A bare pincode alone is too weak a term (it gets
  // swamped by generic "how to search MCA" pages), so the surrounding
  // address text is used instead.
  const addressHit = options.websiteData ? findAddressSnippetFromWebsite(options.websiteData) : null;

  return findCompanyCins(legalNameHit?.legalName || companyName, {
    ...options,
    extraTerms: addressHit?.snippet || "",
  });
}

// Stage 2: authoritative exact lookup of a known CIN against data.gov.in's
// Company Master Data. Returns null if the CIN isn't in the dataset.
export async function getCompanyByCin(cin, options = {}) {
  if (!cin) throw new Error("cin is required");

  const apiKey = options.apiKey || process.env.DATA_GOV_API_KEY;
  if (!apiKey) throw new Error("DATA_GOV_API_KEY is not configured");

  const resourceIds = resolveResourceIds(options);

  const resultsPerResource = await Promise.all(
    resourceIds.map((resourceId) =>
      queryCompanyMasterData({ resourceId, apiKey, cin, limit: 1 }).catch((error) => {
        console.error(`data.gov.in lookup failed for resource ${resourceId}:`, error.message);
        return [];
      }),
    ),
  );

  const record = resultsPerResource.flat()[0];

  return record ? mapMcaRecord(record) : null;
}

const INACTIVE_STATUS_PATTERN = /strike off|dissolved|liquidat|amalgamat|defunct/i;

// Search order alone isn't trustworthy: multiple real, distinctly-CINed
// companies can share a near-identical or even identical brand name (e.g. an
// old struck-off entity vs the company actually operating today), so the
// first candidate search happens to surface is not necessarily the right
// one. This scores each candidate against corroborating evidence instead:
// its registered-office pincode matching one the company's own site
// publishes is the strongest signal (an unrelated company won't share that
// address), with active-vs-defunct status as a secondary tiebreak.
function scoreMatch(company, sitePincodes) {
  let score = 0;

  const candidatePincode = [...extractPincodes(company.registeredOfficeAddress)][0];
  if (sitePincodes.size > 0 && candidatePincode && sitePincodes.has(candidatePincode)) {
    score += 5;
  }

  const status = (company.companyStatus || "").toLowerCase();
  if (status === "active") score += 1;
  else if (INACTIVE_STATUS_PATTERN.test(status)) score -= 1;

  return score;
}

// MCA Adapter entry point: chains findCompany -> getCompanyByCin so callers
// can pass a plain company name and get back MCA master data. Does not
// decide what the data means (matching it to the Research Agent's other
// findings, etc) — that's the Normalizer's job, working from this evidence.
//
// Pass `options.cin` to skip the search/resolution step entirely and go
// straight to the authoritative lookup for a CIN a human (or a future,
// better-grounded resolution step) has already confirmed. This matters
// because search-based resolution has a real ceiling: a brand name that
// collides with something unrelated but prominent in the same
// name+locality search (e.g. a real-estate project sharing the company's
// name and neighborhood) can swamp every automated signal available here.
export async function mcaAdapter(companyName, options = {}) {
  if (!companyName) throw new Error("companyName is required");

  const { save = true, outputDir } = options;

  const candidates = options.cin
    ? [{ cin: options.cin, sourceUrl: options.cinSource || null, sourceTitle: "manually confirmed CIN" }]
    : await findCompany(companyName, options);

  const fetched = [];
  for (const candidate of candidates) {
    const company = await getCompanyByCin(candidate.cin, options);
    if (company) {
      fetched.push({ ...company, resolvedFrom: candidate.sourceUrl });
    }
  }

  const sitePincodes = options.websiteData ? extractPincodesFromWebsite(options.websiteData) : new Set();

  // Stable sort: ties keep their original (search-order) relative position.
  const matches = fetched
    .map((company, index) => ({ company, index, score: scoreMatch(company, sitePincodes) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ company }) => company);

  const mcaData = {
    inputName: companyName,
    found: matches.length > 0,
    match: matches[0] || null,
    alternatives: matches.slice(1),
    candidatesConsidered: candidates,
    fetchedAt: new Date().toISOString(),
  };

  const savedTo = save ? await saveRawMcaData(mcaData, outputDir) : null;

  return { ...mcaData, savedTo };
}

// Convenience entry point for "here's the company's website, go find its
// MCA data": crawls the site (unless a crawl result is already passed via
// options.websiteData) and feeds it into mcaAdapter() so the CIN/legal name
// resolution can use whatever the company has published about itself.
export async function mcaAdapterFromWebsite(url, companyName, options = {}) {
  const websiteData = options.websiteData || (await websiteAdapter(url, { save: false }));

  return mcaAdapter(companyName, { ...options, websiteData });
}
