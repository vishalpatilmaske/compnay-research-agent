function formatAddress(address) {
  if (!address) return null;
  return [
    address.premises,
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export function mapCompanyProfile(raw) {
  if (!raw) return null;

  return {
    companyNumber: raw.company_number ?? null,
    companyName: raw.company_name ?? null,
    companyStatus: raw.company_status ?? null,
    companyType: raw.type ?? null,
    jurisdiction: raw.jurisdiction ?? null,
    dateOfCreation: raw.date_of_creation ?? null,
    registeredOfficeAddress: formatAddress(raw.registered_office_address),
    sicCodes: raw.sic_codes || [],
  };
}

// officer_role values used by Companies House ("director",
// "corporate-director", "secretary", "corporate-secretary", "llp-member",
// "member", "nominee-director", ...) are kept verbatim in rawRole; role-
// taxonomy normalization (src/leadership/roleTaxonomy.js) maps them the
// same way it maps any other raw title.
function mapOfficer(raw) {
  return {
    name: raw.name ?? null,
    rawRole: raw.officer_role ?? null,
    appointedOn: raw.appointed_on ?? null,
    resignedOn: raw.resigned_on ?? null,
    nationality: raw.nationality ?? null,
    occupation: raw.occupation ?? null,
    countryOfResidence: raw.country_of_residence ?? null,
  };
}

export function mapOfficers(raw) {
  if (!raw?.items) return { officers: [], activeCount: 0, resignedCount: 0, totalResults: 0 };

  return {
    officers: raw.items.map(mapOfficer),
    activeCount: raw.active_count ?? null,
    resignedCount: raw.resigned_count ?? null,
    totalResults: raw.total_results ?? raw.items.length,
  };
}

// Companies House's own free-text search has no fuzzy score — every
// candidate is tagged with an objective matchType, scored the same way
// sec.finder.js scores SEC ticker/name candidates (never a similarity
// guess).
export function mapSearchResult(item) {
  return {
    companyNumber: item.company_number ?? null,
    title: item.title ?? null,
    companyStatus: item.company_status ?? null,
    companyType: item.company_type ?? null,
    addressSnippet: item.address_snippet ?? null,
    dateOfCreation: item.date_of_creation ?? null,
  };
}
