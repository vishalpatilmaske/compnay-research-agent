import { z } from "zod";

// Every source this system is allowed to cite a person/role claim from.
// "mca" is deliberately excluded from ever appearing on a person-level
// Evidence entry — see mca.adapter usage in leadershipResearch.js for why
// (data.gov.in's Company Master Data has no director/officer field at all;
// MCA is identity-only context here, never leadership evidence).
export const SOURCE_TYPES = [
  "official_company",
  "sec",
  "companies_house",
  "government",
  "search",
  "news",
  "wikidata",
];

export const EVIDENCE_STRENGTHS = ["high", "medium", "low"];
export const CONFIDENCE_LEVELS = ["high", "medium", "low", "uncertain"];
export const CURRENT_STATUSES = ["current", "former", "uncertain"];
export const PERSON_TYPES = ["founder", "executive", "director", "board_member", "other"];

// How directly a piece of source text supports a claim — the Discovery
// Agent classifies this (semantic interpretation is its job), but the
// resulting evidence_strength/confidence is always computed deterministically
// from this tag, never assigned freely by the LLM. See
// confidenceScorer.js#evidenceStrengthFor for the fixed mapping table.
export const CLAIM_EXPLICITNESS = [
  "structured_data", // JSON-LD, an official officers/directors API record, a Wikidata claim
  "explicit_statement", // prose that directly states the name+role
  "title_mention", // name appears with a title nearby but not as a direct statement
  "inferred", // the source implies the role without stating it directly
];

export const EvidenceSchema = z.object({
  source: z.string(),
  source_type: z.enum(SOURCE_TYPES),
  url: z.string().nullable(),
  title: z.string().nullable(),
  claim: z.string(),
  // Verbatim quote/snippet backing the claim, when the source provides one —
  // this is what makes a claim checkable, not just asserted.
  quote: z.string().nullable(),
  published_at: z.string().nullable(),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
  retrieved_at: z.string(),
  evidence_strength: z.enum(EVIDENCE_STRENGTHS),
});

// What the Discovery Agent (and the deterministic pre-fetch steps) produce
// before any validation — a candidate claim, not a finished person record.
// Deliberately missing retrieved_at/evidence_strength: those are computed
// by application code in reportBuilder.js, never set by the LLM.
export const DiscoveryClaimSchema = z.object({
  name: z.string(),
  raw_title: z.string(),
  source: z.string(),
  source_type: z.enum(SOURCE_TYPES),
  url: z.string().nullable(),
  title: z.string().nullable(),
  claim: z.string(),
  quote: z.string().nullable(),
  published_at: z.string().nullable(),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
  claim_explicitness: z.enum(CLAIM_EXPLICITNESS),
});

export const DiscoveryOutputSchema = z.object({
  claims: z.array(DiscoveryClaimSchema),
  // Free-text notes on sources checked/gaps found — folded into the final
  // report's validation.notes, not treated as authoritative on its own.
  notes: z.string().nullable(),
});

const CompanyInfoSchema = z.object({
  name: z.string(),
  legal_name: z.string().nullable(),
  domain: z.string().nullable(),
  country: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  industry: z.string().nullable(),
  founded_year: z.number().nullable(),
});

export const LeadershipPersonSchema = z.object({
  name: z.string(),
  // Primary/most-senior canonical role. See roleTaxonomy.js for the
  // seniority order used to pick this when a person has multiple roles.
  role: z.string(),
  // Every canonical role independently evidenced for this person (e.g. a
  // Founder who is also the current CEO carries both) — improvement over
  // the single-role draft schema so a well-evidenced second title is never
  // silently dropped just to fit one `role` field.
  all_roles: z.array(z.string()),
  raw_titles: z.array(z.string()),
  person_type: z.enum(PERSON_TYPES),
  current_status: z.enum(CURRENT_STATUSES),
  confidence: z.enum(CONFIDENCE_LEVELS),
  // Name of another entry in this same report this person might actually
  // be, when entity resolution couldn't safely merge them (e.g. same last
  // name, incompatible first name/initials) — null when there's no such
  // ambiguity.
  possible_duplicate_of: z.string().nullable(),
  evidence: z.array(EvidenceSchema),
});

const ValidationSchema = z.object({
  sources_checked: z.array(z.string()),
  source_count: z.number(),
  independent_source_count: z.number(),
  conflicts_found: z.number(),
  latest_evidence_date: z.string().nullable(),
  validated_at: z.string(),
  notes: z.array(z.string()),
});

export const LeadershipReportSchema = z.object({
  company: CompanyInfoSchema,
  leadership: z.array(LeadershipPersonSchema),
  validation: ValidationSchema,
});
