// Classification rules used to prioritize which discovered URLs get
// crawled first. Order matters — first matching rule wins.
const PRIORITY_RULES = [
  // CRITICAL: pages that identify the company and its people — always
  // crawled first, regardless of maxPages, so they're never crowded out by
  // a large marketing site's product/solution/service pages.
  { priority: "CRITICAL", category: "home", pattern: /^\/?$/ },
  { priority: "CRITICAL", category: "about", pattern: /about|^\/company/i },
  {
    priority: "CRITICAL",
    category: "team",
    pattern: /\bteam\b|leadership|founders?|our-people|management-team/i,
  },
  { priority: "CRITICAL", category: "contact", pattern: /contact/i },
  { priority: "HIGH", category: "pricing", pattern: /pricing/i },
  { priority: "HIGH", category: "product", pattern: /product/i },
  { priority: "HIGH", category: "solution", pattern: /solution/i },
  { priority: "HIGH", category: "industry", pattern: /industr/i },
  { priority: "HIGH", category: "customer", pattern: /customer/i },
  { priority: "HIGH", category: "case-study", pattern: /case-?stud/i },
  { priority: "HIGH", category: "service", pattern: /service/i },
  { priority: "HIGH", category: "platform", pattern: /platform/i },
  { priority: "HIGH", category: "feature", pattern: /feature/i },
  { priority: "HIGH", category: "use-case", pattern: /use-?case/i },
  { priority: "MEDIUM", category: "blog", pattern: /blog/i },
  { priority: "MEDIUM", category: "news", pattern: /news|press/i },
  { priority: "MEDIUM", category: "careers", pattern: /career|jobs/i },
  { priority: "MEDIUM", category: "partners", pattern: /partner|integration/i },
  {
    priority: "MEDIUM",
    category: "resources",
    pattern: /resource|docs|documentation|faq/i,
  },
  { priority: "LOW", category: "legal", pattern: /privacy|terms|legal|cookie/i },
  {
    priority: "LOW",
    category: "auth",
    pattern: /login|signin|sign-in|signup|sign-up|register|account|cart|checkout/i,
  },
];

const NON_HTML_EXTENSIONS =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|zip|rar|mp4|mov|avi|woff2?|ttf|eot)$/i;
const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?)$/i;

export function classifyUrl(url) {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // keep raw value if not a valid absolute URL
  }

  for (const rule of PRIORITY_RULES) {
    if (rule.pattern.test(pathname)) {
      return { priority: rule.priority, category: rule.category };
    }
  }

  return { priority: "MEDIUM", category: "general" };
}

export function isDocumentUrl(url) {
  return DOCUMENT_EXTENSIONS.test(url);
}

function normalizeHostname(hostname) {
  return hostname.replace(/^www\./, "");
}

// Same-domain, http(s), non-asset, non-document URLs only — everything
// else is either external, a static file, or a document (tracked separately).
export function isCrawlableHtmlUrl(url, baseHostname) {
  try {
    const parsed = new URL(url);
    if (normalizeHostname(parsed.hostname) !== normalizeHostname(baseHostname)) {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (NON_HTML_EXTENSIONS.test(parsed.pathname)) return false;
    if (isDocumentUrl(url)) return false;
    return true;
  } catch {
    return false;
  }
}
