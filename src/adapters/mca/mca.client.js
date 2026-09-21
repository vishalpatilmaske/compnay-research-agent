import axios from "axios";

const DATA_GOV_BASE_URL = "https://api.data.gov.in/resource";

// data.gov.in's Company Master Data resource only supports EXACT match on
// its indexed fields (CIN/CompanyName are "keyword" type, not full text —
// confirmed against the live API: partial names, wildcards, and a free-text
// `q` param are all silently ignored and return zero rows). So this must be
// called with a known CIN or the exact full legal company name, never a
// fuzzy name — resolve that first with mca.finder.js's findCompanyCins().
export async function queryCompanyMasterData({ resourceId, apiKey, cin, companyName, limit = 5 }) {
  if (!resourceId) throw new Error("resourceId is required");
  if (!apiKey) throw new Error("data.gov.in API key is required");
  if (!cin && !companyName) throw new Error("cin or companyName is required");

  const params = {
    "api-key": apiKey,
    format: "json",
    limit,
  };

  if (cin) params["filters[CIN]"] = cin;
  if (companyName) params["filters[CompanyName]"] = companyName;

  const response = await axios.get(`${DATA_GOV_BASE_URL}/${resourceId}`, {
    params,
    timeout: 15000,
  });

  return response.data?.records || [];
}
