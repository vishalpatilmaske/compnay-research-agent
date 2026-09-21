import axios from "axios";

const SUBMISSIONS_BASE_URL = "https://data.sec.gov/submissions";
const COMPANY_FACTS_BASE_URL = "https://data.sec.gov/api/xbrl/companyfacts";
const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

const REQUEST_TIMEOUT = 15000;
const MAX_RETRIES = 3;

// SEC's own fair-access policy (sec.gov/os/accessing-edgar-data) documents
// "Current max request rate: 10 requests/second". We self-throttle well
// under that rather than assume our own retry/backoff logic will never
// burst above it.
const MIN_REQUEST_INTERVAL_MS = 200; // ~5 requests/second

// SEC's documented sample header format is
// "User-Agent: Sample Company Name AdminContact@<domain>.com" — a plain
// app name + real contact email, not a browser-style UA string.
function secHeaders() {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) {
    throw new Error(
      "SEC_USER_AGENT is not configured. SEC requires a declared User-Agent identifying the " +
        'application and a real contact email, e.g. "Hipstraw research@yourcompany.com". Set ' +
        "SEC_USER_AGENT in .env.",
    );
  }

  return {
    "User-Agent": userAgent,
    "Accept-Encoding": "gzip, deflate",
  };
}

// Serializes every SEC request through a single queue with a minimum
// spacing between them, so retries/backoff below can never accidentally
// stack into a burst above the documented rate limit.
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

// SEC error classification, attached to thrown errors as `.secErrorCode` so
// sec.adapter.js can map them to a structured result instead of crashing
// the caller. Retries only fire for genuinely transient conditions —
// 404 (doesn't exist) and 403 (misconfigured/blocked request) are not
// retried, since retrying an identical request won't change either.
function classifyError(error) {
  if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
    return { code: "NETWORK_TIMEOUT", retryable: true };
  }
  const status = error.response?.status;
  if (status === 404) return { code: "SEC_404", retryable: false };
  if (status === 403) return { code: "SEC_403", retryable: false };
  if (status === 429) return { code: "RATE_LIMITED", retryable: true };
  if (status >= 500) return { code: "SEC_TEMPORARY_ERROR", retryable: true };
  if (!error.response) return { code: "NETWORK_ERROR", retryable: true };
  return { code: "SEC_REQUEST_FAILED", retryable: false };
}

async function requestWithRetry(url) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await throttle(() =>
        axios.get(url, { headers: secHeaders(), timeout: REQUEST_TIMEOUT }),
      );
    } catch (error) {
      const { code, retryable } = classifyError(error);
      error.secErrorCode = code;
      lastError = error;

      if (!retryable || attempt === MAX_RETRIES) throw error;

      const backoff = 500 * 2 ** attempt + Math.random() * 250;
      await sleep(backoff);
    }
  }

  throw lastError;
}

function normalizeCikForUrl(cik) {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

// https://data.sec.gov/submissions/CIK##########.json — company-level
// identity (current + former names, tickers, exchanges, SIC, entity type)
// and recent filing history.
export async function fetchSubmissions(cik) {
  const url = `${SUBMISSIONS_BASE_URL}/CIK${normalizeCikForUrl(cik)}.json`;
  const response = await requestWithRetry(url);
  return response.data;
}

// https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json —
// structured XBRL financial facts. Not every filer has these (SEC_404 is
// expected and handled by the caller, not treated as a hard failure).
export async function fetchCompanyFacts(cik) {
  const url = `${COMPANY_FACTS_BASE_URL}/CIK${normalizeCikForUrl(cik)}.json`;
  const response = await requestWithRetry(url);
  return response.data;
}

// https://www.sec.gov/files/company_tickers.json — SEC's official bulk
// ticker/CIK/company-name registry (~10k entries). This is the closest
// thing SEC publishes to a name-search API, so it's the basis for
// sec.finder.js's candidate generation. Cached in-process since it's a
// large, infrequently-updated reference file, not a per-query lookup.
let tickersCache = null;
let tickersCachedAt = 0;
const TICKERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function fetchCompanyTickers() {
  if (tickersCache && Date.now() - tickersCachedAt < TICKERS_CACHE_TTL_MS) {
    return tickersCache;
  }

  const response = await requestWithRetry(COMPANY_TICKERS_URL);
  tickersCache = Object.values(response.data);
  tickersCachedAt = Date.now();
  return tickersCache;
}
