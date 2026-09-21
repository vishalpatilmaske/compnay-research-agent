import { crawlWebsite } from "./website.crawler.js";
import { extractWebsiteData } from "./website.extractor.js";
import { buildLeadershipRollup } from "./website.leadership.js";
import { saveRawData } from "./website.store.js";

// Website Adapter entry point: Discover -> Crawl -> Extract -> Preserve -> Return.
// It does not decide what the data means (market, ICP, etc.) — that is the
// Research Agent's job, working from this raw evidence. `leadership` is the
// one exception: it's deterministic (JSON-LD, name+title patterns, image
// captions, LinkedIn links — see website.leadership.js), not an LLM
// interpretation, so it's computed here and saved as part of the raw record
// itself, giving every leader entry a traceable source_url + evidence quote.
export async function websiteAdapter(url, options = {}) {
  const { maxPages, save = true, outputDir } = options;

  const crawlResult = await crawlWebsite(url, { maxPages });

  const websiteData = {
    baseUrl: url,
    crawledAt: new Date().toISOString(),
    ...extractWebsiteData(crawlResult),
  };

  websiteData.leadership = buildLeadershipRollup(websiteData.pages);

  const savedTo = save ? await saveRawData(websiteData, outputDir) : null;

  return { ...websiteData, savedTo };
}
