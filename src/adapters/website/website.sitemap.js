import axios from "axios";
import * as cheerio from "cheerio";

const REQUEST_TIMEOUT = 10000;
const MAX_SITEMAPS_TO_FOLLOW = 5;
const MAX_URLS_FROM_SITEMAPS = 500;

async function fetchText(url) {
  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: { "User-Agent": "Mozilla/5.0 CompanyResearchBot/1.0" },
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }
    return null;
  } catch {
    return null;
  }
}

async function getSitemapUrlsFromRobots(baseUrl) {
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();
  const robotsTxt = await fetchText(robotsUrl);

  if (!robotsTxt || typeof robotsTxt !== "string") return [];

  const sitemapUrls = [];
  for (const line of robotsTxt.split("\n")) {
    const match = line.match(/^\s*sitemap:\s*(\S+)/i);
    if (match) sitemapUrls.push(match[1].trim());
  }
  return sitemapUrls;
}

function parseSitemapXml(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });

  if ($("sitemapindex").length > 0) {
    const childSitemaps = [];
    $("sitemap > loc").each((_, el) => {
      childSitemaps.push($(el).text().trim());
    });
    return { isIndex: true, urls: [], childSitemaps };
  }

  const urls = [];
  $("url > loc").each((_, el) => {
    urls.push($(el).text().trim());
  });
  return { isIndex: false, urls, childSitemaps: [] };
}

// Checks robots.txt + the two conventional sitemap paths, then follows
// sitemap index files (bounded) to pull out every <loc> URL they list.
export async function discoverSitemapUrls(baseUrl) {
  const sitemapsFound = [];
  const pageUrls = new Set();

  const seenSitemaps = new Set([
    ...(await getSitemapUrlsFromRobots(baseUrl)),
    new URL("/sitemap.xml", baseUrl).toString(),
    new URL("/sitemap_index.xml", baseUrl).toString(),
  ]);

  const queue = [...seenSitemaps];
  let processed = 0;

  while (
    queue.length > 0 &&
    processed < MAX_SITEMAPS_TO_FOLLOW &&
    pageUrls.size < MAX_URLS_FROM_SITEMAPS
  ) {
    const sitemapUrl = queue.shift();
    processed += 1;

    const xml = await fetchText(sitemapUrl);
    if (!xml || typeof xml !== "string" || !xml.includes("<")) continue;

    sitemapsFound.push(sitemapUrl);
    const { isIndex, urls, childSitemaps } = parseSitemapXml(xml);

    if (isIndex) {
      for (const child of childSitemaps) {
        if (!seenSitemaps.has(child)) {
          seenSitemaps.add(child);
          queue.push(child);
        }
      }
    } else {
      for (const url of urls) {
        pageUrls.add(url);
        if (pageUrls.size >= MAX_URLS_FROM_SITEMAPS) break;
      }
    }
  }

  return {
    sitemapsFound,
    urls: [...pageUrls],
  };
}
