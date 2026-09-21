import { discoverSitemapUrls } from "./website.sitemap.js";
import { buildCommonPageUrls } from "./website.commonPages.js";
import { classifyUrl, isCrawlableHtmlUrl } from "./website.priority.js";
import { fetchRobotsRules, isAllowedByRobots } from "./website.robots.js";
import { launchBrowser, scrapePageWithBrowser } from "./website.scraper.js";

const DEFAULT_MAX_PAGES = 20;
const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

// Discover phase: sitemap URLs + guessed common pages, merged, deduped,
// filtered to same-domain HTML pages and to whatever robots.txt actually
// permits, then classified into HIGH/MEDIUM/LOW.
export async function discoverAndPrioritizeUrls(baseUrl) {
  const hostname = new URL(baseUrl).hostname;

  const [sitemapResult, commonUrls, robotsRules] = await Promise.all([
    discoverSitemapUrls(baseUrl),
    Promise.resolve(buildCommonPageUrls(baseUrl)),
    fetchRobotsRules(baseUrl),
  ]);

  const allUrls = new Set();
  let disallowedByRobots = 0;

  for (const url of [...sitemapResult.urls, ...commonUrls]) {
    const normalized = normalizeUrl(url);
    if (!normalized || !isCrawlableHtmlUrl(normalized, hostname)) continue;

    if (!isAllowedByRobots(normalized, robotsRules)) {
      disallowedByRobots += 1;
      continue;
    }

    allUrls.add(normalized);
  }

  const classified = [...allUrls].map((url) => ({
    url,
    ...classifyUrl(url),
  }));

  classified.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return {
    sitemapsFound: sitemapResult.sitemapsFound,
    totalDiscovered: classified.length,
    disallowedByRobots,
    urls: classified,
  };
}

// Crawl phase: takes the prioritized URL list, caps it at maxPages, and
// scrapes each one with a single shared browser instance.
export async function crawlWebsite(baseUrl, options = {}) {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const discovery = await discoverAndPrioritizeUrls(baseUrl);
  const urlsToCrawl = discovery.urls.slice(0, maxPages);

  const browser = await launchBrowser();
  const pages = [];

  try {
    for (const { url, priority, category } of urlsToCrawl) {
      const pageData = await scrapePageWithBrowser(browser, url);
      pages.push({ ...pageData, priority, category });
    }
  } finally {
    await browser.close();
  }

  return {
    discovery,
    crawledCount: pages.length,
    pages,
  };
}
