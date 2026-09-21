import { chromium } from "playwright";

const PAGE_TIMEOUT = 30000;

const EMPTY_PAGE_DATA = {
  title: null,
  html: null,
  text: null,
  metaDescription: null,
  metaKeywords: null,
  canonicalUrl: null,
  language: null,
  openGraph: {},
  twitter: {},
  headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
  paragraphs: [],
  lists: [],
  links: [],
  images: [],
  documents: [],
  videos: [],
  jsonLd: [],
  socialLinks: [],
};

export async function launchBrowser() {
  return chromium.launch({ headless: true });
}

function extractPageData() {
  const getMeta = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.getAttribute("content") : null;
  };

  const metaDescription =
    getMeta('meta[name="description"]') || getMeta('meta[property="og:description"]');
  const metaKeywords = getMeta('meta[name="keywords"]');

  const canonicalEl = document.querySelector('link[rel="canonical"]');
  const canonicalUrl = canonicalEl ? canonicalEl.getAttribute("href") : null;
  const language = document.documentElement.getAttribute("lang");

  const openGraph = {};
  document.querySelectorAll('meta[property^="og:"]').forEach((el) => {
    const key = el.getAttribute("property").replace("og:", "");
    openGraph[key] = el.getAttribute("content");
  });

  const twitter = {};
  document.querySelectorAll('meta[name^="twitter:"]').forEach((el) => {
    const key = el.getAttribute("name").replace("twitter:", "");
    twitter[key] = el.getAttribute("content");
  });

  const headings = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
  Object.keys(headings).forEach((tag) => {
    document.querySelectorAll(tag).forEach((el) => {
      const value = el.innerText.trim();
      if (value) headings[tag].push(value);
    });
  });

  const paragraphs = [...document.querySelectorAll("p")]
    .map((el) => el.innerText.trim())
    .filter(Boolean);

  const lists = [...document.querySelectorAll("ul, ol")]
    .map((listEl) =>
      [...listEl.querySelectorAll(":scope > li")]
        .map((li) => li.innerText.trim())
        .filter(Boolean)
    )
    .filter((items) => items.length > 0);

  const links = [...document.querySelectorAll("a[href]")].map((a) => ({
    text: a.innerText.trim(),
    href: a.href,
  }));

  const images = [...document.querySelectorAll("img")].map((img) => ({
    src: img.src,
    alt: img.getAttribute("alt") || "",
  }));

  const documents = [...document.querySelectorAll("a[href]")]
    .map((a) => a.href)
    .filter((href) => /\.(pdf|docx?|xlsx?|pptx?)$/i.test(href));

  const videos = [...document.querySelectorAll("video, iframe")]
    .map((el) => el.getAttribute("src") || el.getAttribute("data-src"))
    .filter((src) => src && /youtube|vimeo|wistia|\.mp4|\.webm/i.test(src));

  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((el) => {
      try {
        return JSON.parse(el.textContent);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const socialPattern =
    /facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|github\.com/i;
  const socialLinks = [
    ...new Set(
      [...document.querySelectorAll("a[href]")]
        .map((a) => a.href)
        .filter((href) => socialPattern.test(href))
    ),
  ];

  return {
    metaDescription,
    metaKeywords,
    canonicalUrl,
    language,
    openGraph,
    twitter,
    headings,
    paragraphs,
    lists,
    links,
    images,
    documents,
    videos,
    jsonLd,
    socialLinks,
  };
}

// Scrapes a single URL using an already-launched browser (used by the
// crawler, which reuses one browser instance across many pages).
export async function scrapePageWithBrowser(browser, url) {
  const page = await browser.newPage();
  const scrapedAt = new Date().toISOString();

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT,
    });

    await page
      .locator("body")
      .waitFor({ timeout: PAGE_TIMEOUT })
      .catch(() => {});

    const statusCode = response ? response.status() : null;
    const finalUrl = page.url();

    const title = await page.title();
    const html = await page.content();
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const pageData = await page.evaluate(extractPageData);

    return {
      url,
      finalUrl,
      statusCode,
      scrapedAt,
      error: null,
      title,
      html,
      text,
      ...pageData,
    };
  } catch (error) {
    return {
      url,
      finalUrl: null,
      statusCode: null,
      scrapedAt,
      error: error.message,
      ...EMPTY_PAGE_DATA,
    };
  } finally {
    await page.close();
  }
}

// Convenience wrapper for scraping a single URL in isolation (launches
// and closes its own browser). Prefer scrapePageWithBrowser for crawls.
export async function scrapePage(url) {
  const browser = await launchBrowser();
  try {
    return await scrapePageWithBrowser(browser, url);
  } finally {
    await browser.close();
  }
}
