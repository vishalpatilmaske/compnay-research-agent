import dotenv from "dotenv";
dotenv.config();

import { mcaAdapter, mcaAdapterFromWebsite } from "./adapters/mca/mca.adapter.js";

// Usage:
//   node src/testMca.js "Optimus BT"
//   node src/testMca.js "Optimus BT" https://www.optimusbt.com/
const companyName = process.argv[2] || "Optimus BT";
const websiteUrl = process.argv[3];

const result = websiteUrl
  ? await mcaAdapterFromWebsite(websiteUrl, companyName)
  : await mcaAdapter(companyName);

console.log({
  inputName: result.inputName,
  found: result.found,
  match: result.match,
  alternativeCount: result.alternatives.length,
  candidatesConsidered: result.candidatesConsidered,
  savedTo: result.savedTo,
});
