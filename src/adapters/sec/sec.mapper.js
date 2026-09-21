// CIK = Central Index Key, always normalized to 10 digits with leading
// zeros (SEC's own submissions responses already return it this way, but
// company_tickers.json and the xbrl/companyfacts response both return it as
// an unpadded number — confirmed against the live API, not assumed).
export function normalizeCik(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(10, "0");
}

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

// Turns filings.recent's parallel-array shape (confirmed against the live
// submissions response — {accessionNumber: [...], form: [...], ...}, one
// index per filing, NOT an array of per-filing objects) into a plain array
// of filing objects, which is far easier for a caller to work with.
function mapRecentFilings(recent) {
  if (!recent || !Array.isArray(recent.accessionNumber)) return [];

  return recent.accessionNumber.map((accessionNumber, i) => ({
    accessionNumber,
    form: recent.form?.[i] ?? null,
    filingDate: recent.filingDate?.[i] ?? null,
    reportDate: recent.reportDate?.[i] ?? null,
    primaryDocument: recent.primaryDocument?.[i] ?? null,
    isXBRL: recent.isXBRL?.[i] === 1,
  }));
}

// Maps data.sec.gov/submissions/CIK##########.json into our normalized
// company/filings shape. Only fields confirmed present in the live
// response are read; nothing here is guessed.
export function mapSubmissions(raw) {
  const cik = normalizeCik(raw?.cik);

  const company = {
    companyName: raw?.name ?? null,
    cik,
    formerNames: (raw?.formerNames || []).map((f) => ({
      name: f.name ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
    })),
    tickers: raw?.tickers || [],
    exchanges: raw?.exchanges || [],
    entityType: raw?.entityType ?? null,
    sic: raw?.sic ?? null,
    sicDescription: raw?.sicDescription ?? null,
    category: raw?.category ?? null,
    stateOfIncorporation: raw?.stateOfIncorporation ?? null,
    fiscalYearEnd: raw?.fiscalYearEnd ?? null,
    website: raw?.website || null,
    investorWebsite: raw?.investorWebsite || null,
  };

  const recentFilings = mapRecentFilings(raw?.filings?.recent);

  const filings = {
    recent: recentFilings,
    forms: [...new Set(recentFilings.map((f) => f.form).filter(Boolean))],
    filingDates: recentFilings.map((f) => f.filingDate).filter(Boolean),
    accessionNumbers: recentFilings.map((f) => f.accessionNumber).filter(Boolean),
  };

  return { company, filings };
}

// A small, documented set of common us-gaap concepts — not every filer has
// every concept (or any at all), so each is read defensively and left null
// rather than guessed. Only the most recent value (by `end` date) per
// concept is kept; the full history stays in the preserved raw response.
const FACT_CONCEPTS = [
  "Assets",
  "Liabilities",
  "StockholdersEquity",
  "Revenues",
  "NetIncomeLoss",
  "CashAndCashEquivalentsAtCarryingValue",
];

function latestFactValue(concept) {
  const usdValues = concept?.units?.USD;
  if (!Array.isArray(usdValues) || usdValues.length === 0) return null;

  const latest = [...usdValues].sort((a, b) => (a.end < b.end ? 1 : -1))[0];

  return {
    value: latest.val ?? null,
    end: latest.end ?? null,
    fiscalYear: latest.fy ?? null,
    fiscalPeriod: latest.fp ?? null,
    form: latest.form ?? null,
    accessionNumber: latest.accn ?? null,
  };
}

// Maps data.sec.gov/api/xbrl/companyfacts/CIK##########.json into a small
// normalized summary. Returns null (not a throw) when the filer has no
// XBRL facts at all — that's an expected, non-error condition for some
// filers, called out explicitly in the SEC adapter's error-handling spec.
export function mapCompanyFacts(raw) {
  if (!raw?.facts) return null;

  const usGaap = raw.facts["us-gaap"] || {};
  const facts = {};

  for (const concept of FACT_CONCEPTS) {
    facts[concept] = usGaap[concept] ? latestFactValue(usGaap[concept]) : null;
  }

  return {
    entityName: raw.entityName ?? null,
    cik: normalizeCik(raw.cik),
    facts,
  };
}
