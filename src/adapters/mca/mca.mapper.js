// data.gov.in's live schema for this resource uses names like "CompanyName",
// "CompanyRegistrationdate_date", "CompanyStateCode" (confirmed against the
// API directly), but other MCA-derived resources have used slightly
// different spellings. Rather than pin to one exact spelling, records are
// looked up through a normalized (lowercase, alphanumeric-only) field index.
function buildFieldIndex(record) {
  const index = {};
  for (const key of Object.keys(record)) {
    index[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = record[key];
  }
  return index;
}

function pick(index, candidates) {
  for (const candidate of candidates) {
    const key = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (index[key] !== undefined && index[key] !== "") {
      return index[key];
    }
  }
  return null;
}

// Strips legal suffixes/punctuation so "ABC Technologies Pvt. Ltd." and
// "ABC TECHNOLOGIES PRIVATE LIMITED" compare equal.
export function normalizeCompanyName(name) {
  return (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function extractCompanyName(record) {
  return pick(buildFieldIndex(record), ["CompanyName", "company_name"]);
}

export function mapMcaRecord(record) {
  const index = buildFieldIndex(record);

  return {
    companyName: pick(index, ["CompanyName", "company_name"]),
    cin: pick(index, ["CIN", "corporate_identification_number"]),
    companyStatus: pick(index, ["CompanyStatus", "company_status"]),
    companyClass: pick(index, ["CompanyClass", "company_class"]),
    companyCategory: pick(index, ["CompanyCategory", "company_category"]),
    authorizedCapital: pick(index, ["AuthorizedCapital", "authorized_capital"]),
    paidUpCapital: pick(index, ["PaidupCapital", "paid_up_capital"]),
    dateOfRegistration: pick(index, ["CompanyRegistrationdate_date", "date_of_registration"]),
    registeredState: pick(index, ["CompanyStateCode", "registered_state"]),
    registrarOfCompanies: pick(index, ["CompanyROCcode", "registrar_of_companies"]),
    registeredOfficeAddress: pick(index, ["Registered_Office_Address", "registered_office_address"]),
    raw: record,
  };
}
