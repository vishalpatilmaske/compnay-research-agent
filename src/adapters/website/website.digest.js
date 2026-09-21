import { buildLeadershipRollup } from "./website.leadership.js";

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAX_PARAGRAPH_CHARS = 3000;
const MAX_EVIDENCE_CHARS = 200;

function extractEmails(page) {
  const fromLinks = page.links
    .filter((link) => link.href?.startsWith("mailto:"))
    .map((link) => link.href.replace(/^mailto:/i, "").split("?")[0].trim());

  const fromText = page.text ? page.text.match(EMAIL_PATTERN) || [] : [];

  return [...new Set([...fromLinks, ...fromText])].filter(Boolean);
}

function extractPhoneLinks(page) {
  return [
    ...new Set(
      page.links
        .filter((link) => link.href?.startsWith("tel:"))
        .map((link) => link.href.replace(/^tel:/i, "").trim())
        .filter(Boolean),
    ),
  ];
}

function formatPage(page) {
  if (page.error) return null;

  const headingLines = Object.entries(page.headings || {})
    .flatMap(([tag, values]) => values.map((v) => `${tag.toUpperCase()}: ${v}`))
    .slice(0, 20);

  const paragraphs = (page.paragraphs || []).join("\n").slice(0, MAX_PARAGRAPH_CHARS);

  const listItems = (page.lists || [])
    .flat()
    .slice(0, 40)
    .join("\n");

  const emails = extractEmails(page);
  const phones = extractPhoneLinks(page);

  const sections = [
    `=== PAGE: ${page.category || "general"} (${page.url}) ===`,
    page.title ? `Title: ${page.title}` : null,
    page.metaDescription ? `Meta description: ${page.metaDescription}` : null,
    headingLines.length ? `Headings:\n${headingLines.join("\n")}` : null,
    paragraphs ? `Content:\n${paragraphs}` : null,
    listItems ? `List items:\n${listItems}` : null,
    emails.length ? `Emails found on this page: ${emails.join(", ")}` : null,
    phones.length ? `Phone numbers found on this page: ${phones.join(", ")}` : null,
    page.socialLinks?.length ? `Social links: ${page.socialLinks.join(", ")}` : null,
  ].filter(Boolean);

  return { text: sections.join("\n\n"), emails, phones };
}

// Renders the deterministic leadership rollup (see website.leadership.js) as
// a dedicated, high-confidence block the agent reads before anything else —
// each entry names exactly which page and which quote/markup it came from,
// so the agent has verifiable proof to attach as source_url instead of
// having to re-derive names/titles from raw paragraphs on its own.
function formatLeadershipSection(leadership) {
  if (!leadership.length) return null;

  const entries = leadership.map((person) => {
    const lines = [`- ${person.name}${person.title ? ` — ${person.title}` : ""}`];
    lines.push(`  Source: ${person.source_urls.join(", ")}`);
    if (person.linkedin_url) lines.push(`  LinkedIn: ${person.linkedin_url}`);
    if (person.photo_url) lines.push(`  Photo: ${person.photo_url}`);
    if (person.email) lines.push(`  Email: ${person.email}`);
    if (person.phone) lines.push(`  Phone: ${person.phone}`);

    const proof = person.evidence[0];
    if (proof) {
      lines.push(
        `  Evidence (${proof.method}): ${proof.quote.slice(0, MAX_EVIDENCE_CHARS)}`,
      );
    }

    return lines.join("\n");
  });

  return [
    "=== VERIFIED LEADERSHIP (extracted directly from site markup — high-confidence, each entry has a source_url as proof) ===",
    entries.join("\n\n"),
  ].join("\n");
}

// Turns a crawl result (multiple scraped pages) into a single text blob the
// research agent can read directly: a verified-leadership block up front,
// plus a deduped roll-up of every email and tel: phone link found anywhere
// on the site — grounding for founders/executives/key_people so the agent
// isn't limited to Apollo for details already published on the company's
// own site.
export function buildWebsiteDigest(crawlResult) {
  const formatted = (crawlResult.pages || [])
    .map(formatPage)
    .filter(Boolean);

  const allEmails = [...new Set(formatted.flatMap((p) => p.emails))];
  const allPhones = [...new Set(formatted.flatMap((p) => p.phones))];

  const leadership = crawlResult.leadership || buildLeadershipRollup(crawlResult.pages);
  const leadershipSection = formatLeadershipSection(leadership);

  const digestText = [leadershipSection, ...formatted.map((p) => p.text)]
    .filter(Boolean)
    .join("\n\n");

  return {
    pageCount: formatted.length,
    digestText,
    allEmails,
    allPhones,
    leadership,
  };
}
