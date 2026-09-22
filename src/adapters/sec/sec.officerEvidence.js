import * as cheerio from "cheerio";

import { fetchFilingDocument } from "./sec.client.js";
import { pickOfficerFiling } from "./sec.mapper.js";

// A DEF 14A can run 200-300k+ characters, and its useful "who holds what
// title" content (director nominee bios, "Chief Executive Officer since...")
// typically doesn't start until well past the notice/table-of-contents/
// summary front matter — confirmed against a live Apple filing, where an
// explicit "Chief Executive Officer since" mention didn't appear until
// character ~63,000. 80k keeps a comfortable margin past that while still
// being a small fraction of the full document.
const MAX_TEXT_CHARS = 80000;

function htmlToText(html) {
  const $ = cheerio.load(html);
  $("script, style").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

// Fetches the single most relevant SEC filing likely to name executive
// officers/directors (see sec.mapper.js#pickOfficerFiling) and strips it to
// plain text — real, citable evidence with a real SEC Archives URL, since
// submissions.json itself has no officer field to read from. Returns null
// (never throws) when there's no suitable filing or the fetch fails; this
// is an enrichment step, not a hard requirement for the leadership pipeline.
export async function getOfficerFilingEvidence(cik, filings) {
  const filing = pickOfficerFiling(filings);
  if (!filing) return null;

  try {
    const { url, html } = await fetchFilingDocument(
      cik,
      filing.accessionNumber,
      filing.primaryDocument,
    );

    return {
      url,
      form: filing.form,
      filingDate: filing.filingDate,
      text: htmlToText(html).slice(0, MAX_TEXT_CHARS),
    };
  } catch (error) {
    console.error(`SEC officer filing fetch failed for CIK ${cik}:`, error.message);
    return null;
  }
}
