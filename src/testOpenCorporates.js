import dotenv from "dotenv";
dotenv.config();

import { openCorporatesAdapter } from "./adapters/opencorporates/opencorporates.adapter.js";

// Usage:
//   node src/testOpenCorporates.js "Tesla"                          company-name lookup
//   node src/testOpenCorporates.js "Tesla" us_de                    jurisdiction-scoped lookup
//   node src/testOpenCorporates.js "Tesla" us_de officers            also fetch officers
function printResult(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log({
    query: result.query,
    match: result.match,
    company: result.company,
    officers: result.officers,
    evidence: result.evidence,
    error: result.error,
    savedTo: result.savedTo,
  });
}

async function main() {
  const companyName = process.argv[2] || "Tesla";
  const jurisdiction = process.argv[3];
  const includeOfficers = process.argv[4] === "officers";

  // 1. Real company lookup.
  const result = await openCorporatesAdapter(companyName, { jurisdiction, includeOfficers });
  printResult(`lookup: "${companyName}"${jurisdiction ? ` (${jurisdiction})` : ""}`, result);

  // 2. A company that should not exist.
  const notFound = await openCorporatesAdapter(
    "Zzqxvunlikely Nonexistent Entity Corporation Zzqxv123456",
    { save: false },
  );
  printResult("lookup: nonexistent company", notFound);

  // 3. Missing companyName.
  const missingName = await openCorporatesAdapter(undefined, { save: false });
  printResult("missing companyName", missingName);

  // 4. Missing/invalid API key.
  const savedKey = process.env.OPENCORPORATES_API_KEY;
  delete process.env.OPENCORPORATES_API_KEY;
  const missingKey = await openCorporatesAdapter(companyName, { save: false });
  printResult("missing OPENCORPORATES_API_KEY", missingKey);
  if (savedKey) process.env.OPENCORPORATES_API_KEY = savedKey;
}

await main();
