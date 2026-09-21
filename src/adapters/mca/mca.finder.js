import axios from "axios";
import * as cheerio from "cheerio";

import { braveSearch } from "../../services/braveSearch.js";

// CIN format is fixed nationally: 1 letter (U/L) + 5 digits + 2-letter state
// code + 4-digit year + 3-letter ownership code + 6-digit sequence, e.g.
// U52100HR2015OPC056314. This lets us pull a CIN out of arbitrary search
// snippets/page text without depending on any one site's markup.
const CIN_PATTERN = /\b[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/g;

function extractCins(text) {
  return [...new Set([...(text || "").matchAll(CIN_PATTERN)].map((m) => m[0]))];
}

// Fetching a full page and grabbing "the first CIN mentioned" is only safe
// on a page that's actually a single company's profile — a generic
// government/reference/explainer page can quote an unrelated CIN purely as
// a format example (this happened in testing: org-id.guide's explainer page
// yielded a real but completely unrelated company's CIN). So the page-fetch
// fallback is restricted to known company-record aggregators.
const COMPANY_PROFILE_DOMAINS = [
  "zaubacorp.com",
  "indiafilings.com",
  "cleartax.in",
  "tofler.in",
  "thecompanycheck.com",
  "falconebiz.com",
  "economictimes.indiatimes.com",
  "probe42.in",
  "instafinancials.com",
  "mca.gov.in",
];

function isCompanyProfileDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return COMPANY_PROFILE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

// Matches a legal-entity name ending in a standard Indian company suffix,
// e.g. the "XYZ Software India Private Limited" in a footer copyright line
// like "© 2024 XYZ Software India Private Limited. All rights reserved."
const LEGAL_SUFFIX_PATTERN =
  /\b([A-Z][A-Za-z0-9&.,'\-\s]{1,80}?(?:Private Limited|Pvt\.?\s*Ltd\.?|LLP|Limited))\b/;

// A company that publishes its own CIN (footer, privacy policy, terms page,
// etc.) is far stronger evidence than anything web search can infer, since
// it's self-declared rather than guessed from a third-party aggregator.
// `websiteData` is the Website Adapter's crawl result (its `pages` array).
export function findCinFromWebsite(websiteData) {
  for (const page of websiteData?.pages || []) {
    const cin = extractCins(page.text)[0];
    if (cin) {
      return { cin, sourceUrl: page.url, sourceTitle: page.title, source: "website" };
    }
  }
  return null;
}

// Falls back to a legal entity name mentioned on the site when no CIN is
// published there — a much more precise search query than the casual brand
// name a user typed in (e.g. "Optimus BT" -> "OptimusBT Software India
// Private Limited").
export function findLegalNameFromWebsite(websiteData) {
  for (const page of websiteData?.pages || []) {
    const match = (page.text || "").match(LEGAL_SUFFIX_PATTERN);
    if (match) {
      return { legalName: match[1].trim(), sourceUrl: page.url, sourceTitle: page.title };
    }
  }
  return null;
}

// Indian PIN codes are 6 digits, sometimes written with a middle space
// ("560 034"). Used to disambiguate between same-named/similarly-named MCA
// candidates by checking whether a candidate's registered-office pincode is
// one the company's own site actually publishes (e.g. on a Contact page) —
// far more reliable than name similarity, since an unrelated company can
// have a near-identical name while an old/defunct one can share the exact
// brand name but a different address.
const PINCODE_PATTERN = /\b(\d{3})\s?(\d{3})\b/g;

export function extractPincodes(text) {
  return new Set([...(text || "").matchAll(PINCODE_PATTERN)].map((m) => m[1] + m[2]));
}

export function extractPincodesFromWebsite(websiteData) {
  const pincodes = new Set();
  for (const page of websiteData?.pages || []) {
    for (const pincode of extractPincodes(page.text)) {
      pincodes.add(pincode);
    }
  }
  return pincodes;
}

// A bare 6-digit pincode is too weak a search term on its own — dropped
// alone into a query, it gets swamped by generic "how to search MCA" pages.
// The locality words right before it are what actually narrow a search
// down to the right entity (e.g. "Koramangala 1st Block 560034"), but a
// building/suite name a few words further back (e.g. "NAVS Arcade") is
// often shared by many unrelated businesses in the same building and hurts
// more than it helps. Whole words (not a raw character slice, which can
// start mid-word) are used, capped at the 4 immediately preceding the
// pincode, to stay close to the pincode without pulling in that noise.
export function findAddressSnippetFromWebsite(websiteData) {
  for (const page of websiteData?.pages || []) {
    const words = (page.text || "").split(/\s+/).filter(Boolean);

    for (let i = 0; i < words.length; i++) {
      const isSplitPin = /^\d{3}$/.test(words[i]) && /^\d{3}$/.test(words[i + 1] || "");
      const isJoinedPin = /^\d{6}$/.test(words[i]);

      if (!isSplitPin && !isJoinedPin) continue;

      const pinWordCount = isSplitPin ? 2 : 1;
      const snippet = words
        .slice(Math.max(0, i - 4), i + pinWordCount)
        .map((w) => w.replace(/[,:;#]/g, ""))
        .filter(Boolean)
        .join(" ");

      return { snippet, sourceUrl: page.url, sourceTitle: page.title };
    }
  }

  return null;
}

async function fetchPageText(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 CompanyResearchBot/1.0" },
    });

    const $ = cheerio.load(response.data);
    $("script, style, noscript").remove();

    return $("body").text().replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

// Picks the single CIN a search result is actually about, rather than every
// CIN mentioned anywhere in it — a result page can easily mention other CINs
// too (a director's other companies, a "similar companies" widget), and
// those would otherwise pollute the candidate list with unrelated matches.
// Aggregator sites commonly put the subject's own CIN in the URL slug, so
// that's checked first; otherwise the first CIN in the snippet/page text
// (its most prominent mention) is used.
function primaryCin(text, url) {
  return extractCins(url)[0] || extractCins(text)[0] || null;
}

// data.gov.in's Company Master Data has no fuzzy/partial name search — only
// exact CIN or exact full legal CompanyName. So resolving a casual input
// like "Optimus BT" starts here: search the web for it and pull out the CIN
// each result is about (search snippets first, falling back to fetching a
// few result pages), each tagged with the source it came from so the CIN is
// traceable, not just asserted.
export async function findCompanyCins(
  companyName,
  { maxCandidates = 3, maxPageFetches = 3, extraTerms = "" } = {},
) {
  // Not quoted: the registered legal name almost never matches the input
  // verbatim (it adds/drops "Software"/"India"/"Private Limited", collapses
  // spacing, etc — e.g. "Optimus BT" is legally "OptimusBT Software India
  // Private Limited") and an exact-phrase search would filter out the very
  // result we need. `extraTerms` (typically a pincode pulled from the
  // company's own site) narrows the search when the plain name alone is too
  // ambiguous to surface the right entity among several similarly-named
  // companies.
  const results = await braveSearch(
    [companyName, extraTerms, "CIN Ministry of Corporate Affairs India"].filter(Boolean).join(" "),
  );

  const candidates = [];
  const seenCins = new Set();
  let pageFetches = 0;

  for (const result of results) {
    if (candidates.length >= maxCandidates) break;

    let cin = primaryCin(`${result.title} ${result.description}`, result.url);

    if (!cin && isCompanyProfileDomain(result.url) && pageFetches < maxPageFetches) {
      pageFetches += 1;
      cin = extractCins(await fetchPageText(result.url))[0] || null;
    }

    if (cin && !seenCins.has(cin)) {
      seenCins.add(cin);
      candidates.push({ cin, sourceUrl: result.url, sourceTitle: result.title });
    }
  }

  return candidates;
}
