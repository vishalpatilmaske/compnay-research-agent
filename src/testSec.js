import dotenv from "dotenv";
dotenv.config();

import { secAdapter } from "./adapters/sec/sec.adapter.js";

// Usage:
//   node src/testSec.js "Apple"                    company-name lookup
//   node src/testSec.js "Apple" 0000320193          direct CIK override
//   node src/testSec.js "Apple" 0000320193 facts    also fetch XBRL company facts
const companyName = process.argv[2] || "Apple";
const cik = process.argv[3];
const includeFacts = process.argv[4] === "facts";

const result = await secAdapter(companyName, { cik, includeFacts });

console.log({
  query: result.query,
  match: result.match,
  company: result.company,
  filings: result.filings && {
    formCount: result.filings.forms.length,
    recentCount: result.filings.recent.length,
    mostRecent: result.filings.recent.slice(0, 3),
  },
  financialFacts: result.financialFacts,
  evidence: result.evidence,
  error: result.error,
  savedTo: result.savedTo,
});
