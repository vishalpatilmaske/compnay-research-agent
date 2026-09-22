import dotenv from "dotenv";
dotenv.config();

import { researchLeadership } from "./leadershipResearch.js";

// Usage:
//   node src/testLeadership.js "Tesla" "https://www.tesla.com"
//   node src/testLeadership.js "Tesla" "https://www.tesla.com" US
//   node src/testLeadership.js "Optimus BT" "https://www.optimusbt.com" IN
//   node src/testLeadership.js "Company Name"      (domain/country omitted — best-effort)
const companyName = process.argv[2];
const domainArg = process.argv[3];
const countryArg = process.argv[4];

if (!companyName || !companyName.trim()) {
  console.error(
    'Usage: node src/testLeadership.js "<company name>" [domain-or-url] [country]',
  );
  process.exit(1);
}

const domain = domainArg ? domainArg.replace(/^https?:\/\//i, "").replace(/\/$/, "") : undefined;

try {
  const { report, savedTo, sourcesChecked, agentNotes } = await researchLeadership({
    companyName,
    domain,
    country: countryArg,
  });

  console.log("Sources checked:", sourcesChecked.join(", ") || "(none)");
  console.log("Agent notes:", agentNotes || "(none)");
  console.log("Saved to:", savedTo);
  console.log();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error("Leadership research failed:", error.message);
  console.error(error.stack);
  process.exit(1);
}
