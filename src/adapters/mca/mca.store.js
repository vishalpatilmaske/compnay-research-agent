import fs from "fs/promises";
import path from "path";

// Writes the raw MCA lookup result to disk as-is, unmodified, so it can
// always be traced back to when validating a claim later (mirrors
// website.store.js).
export async function saveRawMcaData(data, outputDir = "data/mca") {
  await fs.mkdir(outputDir, { recursive: true });

  const slug =
    data.inputName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outputDir, `${slug}-${timestamp}.json`);

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

  return filePath;
}
