import fs from "fs/promises";
import path from "path";

function slugify(value) {
  return (
    (value || "company")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company"
  );
}

async function writeJson(data, outputDir, slug) {
  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outputDir, `${slug}-${timestamp}.json`);

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

  return filePath;
}

// Raw candidate claims (pre-validation) — kept separate from the final
// report so the report can always be regenerated/audited from exactly what
// was gathered, without ever overwriting that original evidence.
export async function saveRawLeadershipData(data, outputDir = "data/leadership/raw") {
  return writeJson(data, outputDir, slugify(data.company?.name));
}

// The final, validated, Zod-checked report.
export async function saveLeadershipReport(report, outputDir = "data/leadership/reports") {
  return writeJson(report, outputDir, slugify(report.company?.name));
}
