import { DiscoveryClaimSchema, LeadershipReportSchema } from "./schema.js";
import { resolveEntities } from "./entityResolver.js";
import { validateAndResolveRoles } from "./evidenceValidator.js";
import { evidenceStrengthFor, personConfidence } from "./confidenceScorer.js";
import { personTypeForRole } from "./roleTaxonomy.js";
import { saveRawLeadershipData, saveLeadershipReport } from "../adapters/leadership/leadership.store.js";

// Validates a raw candidate claim against the loose Discovery schema (throws
// on malformance — fail loud rather than silently drop a broken claim) and
// attaches the two fields the LLM never sets itself: retrieved_at (when we
// actually fetched/produced this claim) and evidence_strength (a fixed,
// documented lookup from source_type + claim_explicitness — see
// confidenceScorer.js).
function attachComputedFields(rawClaim, retrievedAt) {
  const parsed = DiscoveryClaimSchema.parse(rawClaim);
  return {
    ...parsed,
    retrieved_at: retrievedAt,
    evidence_strength: evidenceStrengthFor(parsed.source_type, parsed.claim_explicitness),
  };
}

// A claim, stripped of the person/role-clustering fields (name, raw_title,
// claim_explicitness), is exactly one Evidence entry.
function toEvidenceEntry(claim) {
  const { name, raw_title, claim_explicitness, ...evidence } = claim;
  return evidence;
}

// `sourcesChecked` records which of *our own* deterministic pre-fetch
// integrations ran; `usedSourceTypes` records what source_type values
// actually ended up in the evidence, which can legitimately differ — the
// Discovery Agent's own web_search/fetch_company_website tools can find and
// read a source's public-facing pages (e.g. Companies House's own website
// is public, unauthenticated HTML) even when our dedicated API integration
// for that source didn't run. Confirmed on a live Tesco PLC run: real
// Companies House director names showed up as source_type "companies_house"
// evidence purely from the agent's own tool calls, with no
// COMPANIES_HOUSE_API_KEY configured at all. The note below should only
// claim a source is genuinely absent from the report, not merely that our
// own integration for it didn't run.
function buildNotes(sourcesChecked, usedSourceTypes) {
  const notes = [
    "MCA (data.gov.in Company Master Data) has no director/officer field in its free dataset; when queried, it only confirms company identity/registration and is never cited as evidence for a person/role claim.",
  ];
  if (!sourcesChecked?.includes("companies_house") && !usedSourceTypes.has("companies_house")) {
    notes.push(
      "No Companies House data (our own integration or the agent's own tools) appears in this report — either the country wasn't resolved to GB, or nothing was found.",
    );
  } else if (!sourcesChecked?.includes("companies_house") && usedSourceTypes.has("companies_house")) {
    notes.push(
      "Companies House evidence in this report came from the Discovery Agent's own web search/fetch tools reading Companies House's public website, not our dedicated API integration (COMPANIES_HOUSE_API_KEY isn't configured for this run).",
    );
  }
  return notes;
}

// Assembles the final, strict leadership report from a company object and a
// flat list of raw candidate claims (from the Discovery Agent plus any
// deterministically pre-fetched structured sources). This is plain,
// deterministic code — no LLM call happens in this function — per the
// "application code performs normalization/validation, the LLM does not
// have the final word" requirement.
export async function buildLeadershipReport({ company, claims, sourcesChecked = [], save = true, outputDir = {} }) {
  const retrievedAt = new Date().toISOString();
  const enrichedClaims = (claims || []).map((claim) => attachComputedFields(claim, retrievedAt));

  const { clusters, ambiguousPairs } = resolveEntities(enrichedClaims);
  const { people, conflictsFound, latestEvidenceDate } = validateAndResolveRoles(clusters);

  const leadership = people.map((person, index) => {
    const evidence = person.claims.map(toEvidenceEntry);
    const confidence = personConfidence(evidence, { hasConflict: person.hasConflict });

    const dupPair = ambiguousPairs.find(([a, b]) => a === index || b === index);
    const possibleDuplicateOf = dupPair
      ? people[dupPair[0] === index ? dupPair[1] : dupPair[0]].canonicalName
      : null;

    return {
      name: person.canonicalName,
      role: person.role,
      all_roles: person.allRoles,
      raw_titles: [...new Set(person.claims.map((c) => c.raw_title))],
      person_type: personTypeForRole(person.role),
      current_status: person.currentStatus,
      confidence,
      possible_duplicate_of: possibleDuplicateOf,
      evidence,
    };
  });

  // Deterministic, stable ordering (role, then name) so repeated runs over
  // the same evidence produce byte-identical output ordering.
  leadership.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

  const usedSourceTypes = new Set(enrichedClaims.map((c) => c.source_type));

  const validation = {
    sources_checked: sourcesChecked,
    source_count: sourcesChecked.length,
    independent_source_count: usedSourceTypes.size,
    conflicts_found: conflictsFound,
    latest_evidence_date: latestEvidenceDate,
    validated_at: retrievedAt,
    notes: buildNotes(sourcesChecked, usedSourceTypes),
  };

  const report = LeadershipReportSchema.parse({ company, leadership, validation });

  let savedTo = null;
  if (save) {
    const rawPath = await saveRawLeadershipData(
      { company, claims: enrichedClaims, sourcesChecked },
      outputDir.raw,
    );
    const reportPath = await saveLeadershipReport(report, outputDir.reports);
    savedTo = { raw: rawPath, report: reportPath };
  }

  return { report, savedTo };
}
