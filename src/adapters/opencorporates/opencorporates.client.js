import axios from "axios";

const API_BASE_URL = "https://api.opencorporates.com/v0.4";

const REQUEST_TIMEOUT = 15000;
const MAX_RETRIES = 3;

// OpenCorporates enforces per-token rate limits (the exact figure depends on
// the plan attached to the token) and does not publish a fixed
// requests/second figure the way SEC does. We self-throttle conservatively
// rather than assume our own retry/backoff logic will never burst.
const MIN_REQUEST_INTERVAL_MS = 500; // ~2 requests/second

// OpenCorporates requires an api_token query param on every request
// (confirmed live: an unauthenticated request returns
// {"error":{"message":"Invalid Api Token. Please check your OpenCorporates account"}}
// with HTTP 401, even for the search endpoint).
function requireApiToken() {
  const apiToken = process.env.OPENCORPORATES_API_KEY;
  if (!apiToken) {
    throw new Error(
      "OPENCORPORATES_API_KEY is not configured. OpenCorporates requires an API token for " +
        "search and company lookups. Set OPENCORPORATES_API_KEY in .env " +
        "(see https://opencorporates.com/api_accounts/new).",
    );
  }
  return apiToken;
}

// Serializes every OpenCorporates request through a single queue with a
// minimum spacing between them, so retries/backoff below can never
// accidentally stack into a burst (mirrors sec.client.js).
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

function throttle(fn) {
  const run = async () => {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return fn();
  };

  const result = requestQueue.then(run, run);
  // Keep the queue alive even if this request fails, so one failure
  // doesn't jam every request queued after it.
  requestQueue = result.catch(() => {});
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// OpenCorporates error classification, attached to thrown errors as
// `.ocErrorCode` so opencorporates.adapter.js can map them to a structured
// result instead of crashing the caller. Retries only fire for genuinely
// transient conditions — 401 (bad/missing token) and 404 (doesn't exist)
// are not retried, since retrying an identical request won't change either.
function classifyError(error) {
  if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
    return { code: "NETWORK_TIMEOUT", retryable: true };
  }
  const status = error.response?.status;
  if (status === 401) return { code: "OC_UNAUTHORIZED", retryable: false };
  if (status === 403) return { code: "OC_FORBIDDEN", retryable: false };
  if (status === 404) return { code: "OC_404", retryable: false };
  if (status === 429) return { code: "RATE_LIMITED", retryable: true };
  if (status >= 500) return { code: "OC_TEMPORARY_ERROR", retryable: true };
  if (!error.response) return { code: "NETWORK_ERROR", retryable: true };
  return { code: "OC_REQUEST_FAILED", retryable: false };
}

async function requestWithRetry(url, params) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await throttle(() =>
        axios.get(url, { params: { ...params, api_token: requireApiToken() }, timeout: REQUEST_TIMEOUT }),
      );
    } catch (error) {
      const { code, retryable } = classifyError(error);
      error.ocErrorCode = code;
      lastError = error;

      if (!retryable || attempt === MAX_RETRIES) throw error;

      const backoff = 500 * 2 ** attempt + Math.random() * 250;
      await sleep(backoff);
    }
  }

  throw lastError;
}

// https://api.opencorporates.com/v0.4/companies/search — OpenCorporates'
// full-text company/legal-entity search. `q` is required; jurisdiction_code
// (e.g. "us_de", "gb") narrows the search when known.
export async function searchCompanies({ query, jurisdictionCode, page = 1, perPage = 30 } = {}) {
  if (!query) throw new Error("query is required");

  const params = { q: query, page, per_page: perPage };
  if (jurisdictionCode) params.jurisdiction_code = jurisdictionCode;

  const response = await requestWithRetry(`${API_BASE_URL}/companies/search`, params);
  return response.data;
}

// https://api.opencorporates.com/v0.4/companies/{jurisdiction_code}/{company_number}
// — authoritative full record for a known company (registered address,
// previous names, source registry, etc).
export async function fetchCompany(jurisdictionCode, companyNumber) {
  if (!jurisdictionCode || !companyNumber) {
    throw new Error("jurisdictionCode and companyNumber are required");
  }

  const url = `${API_BASE_URL}/companies/${jurisdictionCode}/${encodeURIComponent(companyNumber)}`;
  const response = await requestWithRetry(url, {});
  return response.data;
}

// https://api.opencorporates.com/v0.4/companies/{jurisdiction_code}/{company_number}/officers
// — optional, richer detail (directors/officers). Not every jurisdiction's
// source registry publishes officer data.
export async function fetchCompanyOfficers(jurisdictionCode, companyNumber) {
  if (!jurisdictionCode || !companyNumber) {
    throw new Error("jurisdictionCode and companyNumber are required");
  }

  const url = `${API_BASE_URL}/companies/${jurisdictionCode}/${encodeURIComponent(companyNumber)}/officers`;
  const response = await requestWithRetry(url, {});
  return response.data;
}
