function dedupeBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

// Normalizes one scraped page: dedupes links/images/documents. Does not
// reinterpret content — that belongs to a future AI-extraction step that
// reads this same raw data to produce structured evidence (company,
// product, market, customer, etc.).
export function normalizePageData(page) {
  if (page.error) return page;

  return {
    ...page,
    links: dedupeBy(page.links, (link) => link.href).filter((link) => link.href),
    images: dedupeBy(page.images, (img) => img.src).filter((img) => img.src),
    documents: [...new Set(page.documents)],
    socialLinks: [...new Set(page.socialLinks)],
  };
}

export function extractWebsiteData(crawlResult) {
  return {
    ...crawlResult,
    pages: crawlResult.pages.map(normalizePageData),
  };
}
