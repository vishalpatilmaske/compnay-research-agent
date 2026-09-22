import axios from "axios";

const BASE_URL = "https://api.company-information.service.gov.uk";
const REQUEST_TIMEOUT = 15000;
const MAX_RETRIES = 3;

// Companies House documents a 600-requests-per-5-minutes limit per API key
// (developer.company-information.service.gov.uk/api/docs/basics/rate-limiting.html)
// — far more generous than SEC's, but self-throttling the same way (a single
// serialized queue with minimum spacing) keeps this client consistent with
// sec.client.js and safe regardless of how many calls one leadership lookup
// makes (search + profile + officers).
const MIN_REQUEST_INTERVAL_MS = 120; // well under ~2/sec average needed to stay under the 5-min cap

function authHeader() {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "COMPANIES_HOUSE_API_KEY is not configured. Get a free key from " +
        "https://developer.company-information.service.gov.uk/ and set it in .env.",
    );
  }
  // Companies House uses HTTP Basic Auth with the API key as the username
  // and an empty password — not a bearer token.
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` };
}

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
  requestQueue = result.catch(() => {});
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirrors sec.client.js's error classification convention: attach a
// `.companiesHouseErrorCode` so companiesHouse.adapter.js can return a
// structured result instead of throwing. 404 (not found) is expected and
// common (most searches for a generic company name resolve to nothing on a
// given try), so it's explicitly not retried.
function classifyError(error) {
  if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
    return { code: "NETWORK_TIMEOUT", retryable: true };
  }
  const status = error.response?.status;
  if (status === 404) return { code: "NOT_FOUND", retryable: false };
  if (status === 401 || status === 403) return { code: "UNAUTHORIZED", retryable: false };
  if (status === 429) return { code: "RATE_LIMITED", retryable: true };
  if (status >= 500) return { code: "TEMPORARY_ERROR", retryable: true };
  if (!error.response) return { code: "NETWORK_ERROR", retryable: true };
  return { code: "REQUEST_FAILED", retryable: false };
}

async function requestWithRetry(path, params) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await throttle(() =>
        axios.get(`${BASE_URL}${path}`, {
          headers: authHeader(),
          params,
          timeout: REQUEST_TIMEOUT,
        }),
      );
    } catch (error) {
      const { code, retryable } = classifyError(error);
      error.companiesHouseErrorCode = code;
      lastError = error;

      if (!retryable || attempt === MAX_RETRIES) throw error;

      const backoff = 500 * 2 ** attempt + Math.random() * 250;
      await sleep(backoff);
    }
  }

  throw lastError;
}

// GET /search/companies — free-text company name search. Companies House's
// own closest thing to a fuzzy search API; candidates still need scoring
// (see companiesHouse.finder.js), nothing here is assumed to be a match.
export async function searchCompanies(query, { itemsPerPage = 10 } = {}) {
  const response = await requestWithRetry("/search/companies", {
    q: query,
    items_per_page: itemsPerPage,
  });
  return response.data;
}

// GET /company/{number} — the authoritative company profile.
export async function fetchCompanyProfile(companyNumber) {
  const response = await requestWithRetry(`/company/${companyNumber}`);
  return response.data;
}

// GET /company/{number}/officers — directors/secretaries with appointment
// (and, when applicable, resignation) dates. This is the one genuinely free
// source of real officer names this system has for the UK.
export async function fetchCompanyOfficers(companyNumber, { itemsPerPage = 50 } = {}) {
  const response = await requestWithRetry(`/company/${companyNumber}/officers`, {
    items_per_page: itemsPerPage,
  });
  return response.data;
}
