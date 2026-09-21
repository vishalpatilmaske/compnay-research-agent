import fs from "fs/promises";
import path from "path";

// Writes the raw SEC lookup result to disk as-is, unmodified, so it can
// always be traced back to when validating a claim later (mirrors
// website.store.js / mca.store.js).
export async function saveRawSecData(data, outputDir = "data/sec") {
  await fs.mkdir(outputDir, { recursive: true });

  const slug =
    (data.query?.companyName || data.query?.cik || "company")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outputDir, `${slug}-${timestamp}.json`);

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

  return filePath;
}
