import fs from "fs/promises";
import path from "path";

// Writes the raw crawl+extract result to disk as-is, unmodified, so it
// can always be traced back to when validating a claim later.
export async function saveRawData(data, outputDir = "data/websites") {
  await fs.mkdir(outputDir, { recursive: true });

  const hostname = new URL(data.baseUrl).hostname.replace(/^www\./, "");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outputDir, `${hostname}-${timestamp}.json`);

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

  return filePath;
}
