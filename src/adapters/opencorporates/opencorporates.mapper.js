// Mirrors sec.mapper.js's normalizeCompanyNameWords: uppercase, strip
// punctuation, split on whitespace. Deliberately not stemmed/suffix-aware
// (legal-suffix differences like "Inc." vs "Corporation" are handled by
// opencorporates.finder.js's extra-word-count tiering, not by guessing here).
function toWords(name) {
  return (name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeCompanyNameWords(name) {
  return toWords(name);
}

export function normalizeJurisdictionCode(input) {
  const code = String(input ?? "").trim().toLowerCase();
  return code || null;
}

// Maps one entry from a /companies/search response (the `company` object
// nested inside `results.companies[i].company`) into our normalized
// candidate shape. Only fields confirmed present in the live API response
// are read; nothing here is guessed.
export function mapSearchResultCompany(raw) {
  if (!raw) return null;

  return {
    companyName: raw.name ?? null,
    companyNumber: raw.company_number ?? null,
    jurisdiction: raw.jurisdiction_code ?? null,
    status: raw.current_status ?? null,
    companyType: raw.company_type ?? null,
    incorporationDate: raw.incorporation_date ?? null,
    dissolutionDate: raw.dissolution_date ?? null,
    inactive: raw.inactive ?? null,
    registeredAddress: raw.registered_address_in_full ?? null,
    registryUrl: raw.registry_url ?? null,
    openCorporatesUrl: raw.opencorporates_url ?? null,
    branch: raw.branch ?? null,
  };
}

// Maps a full /companies/{jurisdiction}/{number} response (the `company`
// object nested inside `results.company`) into our normalized company
// shape. Defensive throughout — company detail is one of the richer OC
// endpoints and fields vary a lot by source registry/jurisdiction.
export function mapCompanyDetail(raw) {
  if (!raw) return null;

  const previousNames = (raw.previous_names || []).map((entry) => ({
    name: entry?.company_name ?? null,
    startDate: entry?.started_date ?? null,
    endDate: entry?.ended_date ?? null,
  }));

  const currentNames = (raw.alternative_names || [])
    .map((entry) => entry?.company_name ?? entry ?? null)
    .filter(Boolean);

  const industryCodes = (raw.industry_codes || [])
    .map((entry) => ({
      code: entry?.industry_code?.code ?? null,
      description: entry?.industry_code?.description ?? null,
      codeScheme: entry?.industry_code?.code_scheme_id ?? null,
    }))
    .filter((entry) => entry.code || entry.description);

  return {
    companyName: raw.name ?? null,
    companyNumber: raw.company_number ?? null,
    jurisdiction: raw.jurisdiction_code ?? null,
    status: raw.current_status ?? null,
    companyType: raw.company_type ?? null,
    incorporationDate: raw.incorporation_date ?? null,
    dissolutionDate: raw.dissolution_date ?? null,
    inactive: raw.inactive ?? null,
    registeredAddress: raw.registered_address_in_full ?? null,
    currentNames,
    previousNames,
    agentName: raw.agent_name ?? null,
    agentAddress: raw.agent_address ?? null,
    industryCodes,
    registryUrl: raw.registry_url ?? null,
    openCorporatesUrl: raw.opencorporates_url ?? null,
    sourceRegistry: {
      publisher: raw.source?.publisher ?? null,
      url: raw.source?.url ?? null,
      retrievedAt: raw.source?.retrieved_at ?? null,
    },
  };
}

// Maps a /companies/{jurisdiction}/{number}/officers response into a plain
// array of officer objects. Not every jurisdiction's source registry
// publishes officer data, so an empty array is expected, not an error.
export function mapOfficers(raw) {
  const officers = raw?.results?.officers || [];

  return officers
    .map((entry) => entry?.officer)
    .filter(Boolean)
    .map((officer) => ({
      name: officer.name ?? null,
      position: officer.position ?? null,
      startDate: officer.start_date ?? null,
      endDate: officer.end_date ?? null,
      nationality: officer.nationality ?? null,
      occupation: officer.occupation ?? null,
    }));
}
