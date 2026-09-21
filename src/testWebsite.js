import { websiteAdapter } from "./adapters/website/website.adapter.js";

const result = await websiteAdapter("https://www.optimusbt.com/", {
  maxPages: 15,
});

console.log({
  baseUrl: result.baseUrl,
  sitemapsFound: result.discovery.sitemapsFound,
  totalDiscovered: result.discovery.totalDiscovered,
  crawledCount: result.crawledCount,
  savedTo: result.savedTo,
  pages: result.pages.map((p) => ({
    url: p.url,
    priority: p.priority,
    category: p.category,
    statusCode: p.statusCode,
    title: p.title,
    linkCount: p.links?.length,
    imageCount: p.images?.length,
    error: p.error,
  })),
});
