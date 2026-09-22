import { run } from "@openai/agents";

import { leadershipDiscoveryAgent } from "./leadershipAgent.js";
import { websiteAdapter } from "./adapters/website/website.adapter.js";
import { buildWebsiteDigest } from "./adapters/website/website.digest.js";
import { secAdapter } from "./adapters/sec/sec.adapter.js";
import { getOfficerFilingEvidence } from "./adapters/sec/sec.officerEvidence.js";
import { companiesHouseAdapter } from "./adapters/companiesHouse/companiesHouse.adapter.js";
import { mcaAdapter } from "./adapters/mca/mca.adapter.js";
import { braveSearch } from "./services/braveSearch.js";
import { findCompanyLeadershipClaims } from "./services/wikidata.js";
import { buildLeadershipReport } from "./leadership/reportBuilder.js";

const MAX_EVIDENCE_PACKET_CHARS = 70000;

// --- Company Resolver -------------------------------------------------

function deriveSiteUrl(domain) {
  if (!domain) return null;
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

// Best-effort, heuristic only (recorded as the resolved `country`, never
// treated as authoritative) — used only to decide which identity sources to
// prioritize; when unresolved, every identity source is tried anyway (see
// gatherEvidence below), so a wrong guess here never hides a real match.
function guessCountry(domain, explicitCountry) {
  if (explicitCountry) return explicitCountry.trim().toUpperCase();
  if (!domain) return null;
  if (/\.in$/i.test(domain)) return "IN";
  if (/\.(co\.uk|uk)$/i.test(domain)) return "GB";
  return null; // .com/.io/.co/etc are globally generic and tell us nothing
}

// --- Claim adapters: turn each source's structured data into the loose
// DiscoveryClaimSchema shape reportBuilder.js expects, deterministically
// (no LLM involved for these — they're already structured/verified). ---

function websiteMethodToExplicitness(method) {
  if (method === "json-ld") return "structured_data";
  if (method === "image-alt" || method === "text-pattern") return "explicit_statement";
  return "title_mention"; // linkedin-link
}

function websiteLeadershipToClaims(websiteData) {
  const leadership = websiteData?.leadership || [];
  const claims = [];

  for (const person of leadership) {
    if (!person.title) continue; // nothing to normalize into a role
    for (const proof of person.evidence) {
      claims.push({
        name: person.name,
        raw_title: person.title,
        source: "company_website",
        source_type: "official_company",
        url: proof.source_url,
        title: null,
        claim: `${person.name} — ${person.title} (per the company's own website)`,
        quote: proof.quote || null,
        published_at: null,
        effective_from: null,
        effective_to: null,
        claim_explicitness: websiteMethodToExplicitness(proof.method),
      });
    }
  }
  return claims;
}

// Companies House officer names come as "SURNAME, Forename" — reversed from
// the "Forename Surname" order every other source uses. Left unreversed,
// entityResolver.js's last-name-token matching would treat the surname as
// a first name and fail to merge this person with the same one found on
// the company website or in a news article.
function reverseCompaniesHouseName(rawName) {
  const parts = (rawName || "").split(",");
  if (parts.length !== 2) return rawName;

  const [surnamePart, forenamePart] = parts.map((p) => p.trim());
  if (!surnamePart || !forenamePart) return rawName;

  const titleCasedSurname = surnamePart
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

  return `${forenamePart} ${titleCasedSurname}`;
}

function companiesHouseOfficersToClaims(chResult) {
  const officers = chResult?.officers?.officers || [];
  const companyNumber = chResult?.match?.companyNumber;
  const url = companyNumber
    ? `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/officers`
    : null;

  return officers.map((officer) => {
    const name = reverseCompaniesHouseName(officer.name);
    return {
      name,
      raw_title: officer.rawRole,
      source: "companies_house",
      source_type: "companies_house",
      url,
      title: "UK Companies House officer record",
      claim: `${name} is recorded as "${officer.rawRole}" for this company on UK Companies House.`,
      quote: null,
      published_at: null,
      effective_from: officer.appointedOn,
      effective_to: officer.resignedOn,
      claim_explicitness: "structured_data",
    };
  });
}

// Wikidata gives month/year-precision dates like "2008-10-00" or even
// "2008-00-00", which Date.parse() rejects outright. Rounding the missing
// day/month down to 01 is a documented approximation good enough for
// ordering/comparison (all evidenceValidator.js needs), not for exact-day
// precision.
function normalizeWikidataDate(value) {
  if (!value) return null;
  const fixed = value.replace(/-00(?=-|$)/g, "-01");
  return Number.isNaN(Date.parse(fixed)) ? null : fixed;
}

function wikidataClaimsToDiscoveryClaims(wikidataResult, companyName) {
  if (!wikidataResult) return [];
  const companyLabel = wikidataResult.companyLabel || companyName;

  return wikidataResult.claims.map((claim) => ({
    name: claim.name,
    raw_title: claim.role,
    source: "wikidata",
    source_type: "wikidata",
    url: wikidataResult.url,
    title: companyLabel,
    claim: `${claim.name} is listed as ${claim.role} of ${companyLabel} on Wikidata.`,
    quote: null,
    published_at: null,
    effective_from: normalizeWikidataDate(claim.startTime),
    effective_to: normalizeWikidataDate(claim.endTime),
    claim_explicitness: "structured_data",
  }));
}

function braveCountryFor(resolvedCountry) {
  if (resolvedCountry === "GB") return "GB";
  if (resolvedCountry === "IN") return "IN";
  return "US";
}

// --- Evidence gathering (deterministic, application code) -------------

async function gatherEvidence({ companyName, domain, resolvedCountry }) {
  const siteUrl = deriveSiteUrl(domain);
  const sourcesChecked = [];
  const claims = [];
  const packetSections = [];

  let websiteData = null;
  if (siteUrl) {
    try {
      websiteData = await websiteAdapter(siteUrl, { maxPages: 12 });
      sourcesChecked.push("website");
      claims.push(...websiteLeadershipToClaims(websiteData));

      const digest = buildWebsiteDigest(websiteData);
      if (digest.digestText) {
        packetSections.push(
          `### Company website (pre-crawled, ${digest.pageCount} pages)\n${digest.digestText}`,
        );
      }
    } catch (error) {
      console.error("Leadership research: website leg failed:", error.message);
    }
  }

  let secResult = null;
  if (!resolvedCountry || resolvedCountry === "US") {
    try {
      secResult = await secAdapter(companyName, { websiteData, includeFacts: false });
      if (secResult?.match?.matchStatus === "MATCHED") {
        sourcesChecked.push("sec");
        const officerEvidence = await getOfficerFilingEvidence(secResult.match.cik, secResult.filings);
        if (officerEvidence) {
          packetSections.push(
            `### SEC filing — ${officerEvidence.form}, filed ${officerEvidence.filingDate}\nURL: ${officerEvidence.url}\n${officerEvidence.text}`,
          );
        }
      }
    } catch (error) {
      console.error("Leadership research: SEC leg failed:", error.message);
    }
  }

  let companiesHouseResult = null;
  if (!resolvedCountry || resolvedCountry === "GB") {
    try {
      companiesHouseResult = await companiesHouseAdapter(companyName, {});
      if (companiesHouseResult?.match?.matchStatus === "MATCHED") {
        sourcesChecked.push("companies_house");
        claims.push(...companiesHouseOfficersToClaims(companiesHouseResult));
      }
    } catch (error) {
      console.error("Leadership research: Companies House leg failed:", error.message);
    }
  }

  let mcaResult = null;
  if (!resolvedCountry || resolvedCountry === "IN") {
    try {
      mcaResult = await mcaAdapter(companyName, { websiteData });
      if (mcaResult?.found) sourcesChecked.push("mca"); // identity only — see reportBuilder's notes
    } catch (error) {
      console.error("Leadership research: MCA leg failed:", error.message);
    }
  }

  try {
    const braveCountry = braveCountryFor(resolvedCountry);
    const queries = [
      `"${companyName}" CEO`,
      `"${companyName}" founder OR co-founder`,
      `"${companyName}" leadership team OR executive team OR management team`,
      `"${companyName}" board of directors`,
    ];
    const results = (
      await Promise.all(
        queries.map((q) => braveSearch(q, { count: 5, country: braveCountry }).catch(() => [])),
      )
    ).flat();

    sourcesChecked.push("brave_search");
    if (results.length) {
      packetSections.push(
        `### Brave Search results\n${results
          .map((r) => `- ${r.title}\n  ${r.url}\n  ${r.description}`)
          .join("\n")}`,
      );
    }
  } catch (error) {
    console.error("Leadership research: Brave Search leg failed:", error.message);
  }

  let wikidataResult = null;
  try {
    wikidataResult = await findCompanyLeadershipClaims(companyName);
    if (wikidataResult?.claims?.length) {
      sourcesChecked.push("wikidata");
      claims.push(...wikidataClaimsToDiscoveryClaims(wikidataResult, companyName));
    }
  } catch (error) {
    console.error("Leadership research: Wikidata leg failed:", error.message);
  }

  return {
    websiteData,
    secResult,
    companiesHouseResult,
    mcaResult,
    sourcesChecked: [...new Set(sourcesChecked)],
    claims,
    packetText: packetSections.join("\n\n---\n\n").slice(0, MAX_EVIDENCE_PACKET_CHARS),
  };
}

function buildDiscoveryPrompt({ companyName, domain, resolvedCountry, packetText }) {
  return `
Research the leadership of this company:

Company name: ${companyName}
${domain ? `Domain: ${domain}` : "Domain: not provided"}
${resolvedCountry ? `Likely country: ${resolvedCountry} (best-effort guess — verify, don't assume)` : "Country: unknown — do not assume one"}

${
  packetText
    ? `Pre-gathered evidence follows. Read it closely first — it's your primary source.\n\n${packetText}`
    : "No pre-gathered evidence was available (e.g. no website/domain given, or every source came back empty) — you'll need to rely on your own tool calls."
}

Extract every founder, co-founder, and executive/board-level leader you can find explicit, checkable evidence for, per your instructions. Output one claim per (person, source) pair.
`;
}

function buildCompanyInfo({ companyName, domain, resolvedCountry, secResult, companiesHouseResult, mcaResult }) {
  const legalName =
    secResult?.company?.companyName ||
    companiesHouseResult?.company?.companyName ||
    mcaResult?.match?.companyName ||
    null;

  const jurisdiction = secResult?.company?.stateOfIncorporation
    ? `US-${secResult.company.stateOfIncorporation}`
    : companiesHouseResult?.company?.jurisdiction || (mcaResult?.found ? "IN" : null);

  const foundedYear =
    (companiesHouseResult?.company?.dateOfCreation &&
      Number(companiesHouseResult.company.dateOfCreation.slice(0, 4))) ||
    (mcaResult?.match?.dateOfRegistration && Number(mcaResult.match.dateOfRegistration.slice(0, 4))) ||
    null;

  return {
    name: companyName,
    legal_name: legalName,
    domain: domain || null,
    country: resolvedCountry,
    jurisdiction,
    industry: secResult?.company?.sicDescription || null,
    founded_year: Number.isFinite(foundedYear) ? foundedYear : null,
  };
}

// Entry point: {companyName, domain?, country?} -> a saved, schema-validated
// LeadershipReport. Every leg of evidence-gathering is independently
// try/caught — one source failing (or not being configured, e.g. no
// Companies House key) never blocks the others or the whole run.
export async function researchLeadership({ companyName, domain, country } = {}) {
  if (!companyName || !companyName.trim()) {
    throw new Error("companyName is required");
  }

  const resolvedCountry = guessCountry(domain, country);

  const evidence = await gatherEvidence({ companyName, domain, resolvedCountry });

  const prompt = buildDiscoveryPrompt({ companyName, domain, resolvedCountry, packetText: evidence.packetText });
  const agentResult = await run(leadershipDiscoveryAgent, prompt);
  const agentOutput = agentResult.finalOutput || { claims: [], notes: null };

  const allClaims = [...evidence.claims, ...agentOutput.claims];

  const company = buildCompanyInfo({
    companyName,
    domain,
    resolvedCountry,
    secResult: evidence.secResult,
    companiesHouseResult: evidence.companiesHouseResult,
    mcaResult: evidence.mcaResult,
  });

  const { report, savedTo } = await buildLeadershipReport({
    company,
    claims: allClaims,
    // "discovery_agent" documents that the LLM extraction step ran (it may
    // also have called fetch_company_website/brave_search/web_search
    // itself for gaps) — not one of the fixed evidence source_type values,
    // just a record of what was checked.
    sourcesChecked: [...evidence.sourcesChecked, "discovery_agent"],
  });

  return {
    report,
    savedTo,
    sourcesChecked: evidence.sourcesChecked,
    agentNotes: agentOutput.notes,
  };
}
