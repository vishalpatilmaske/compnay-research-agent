// Deterministic leadership extraction: scans already-crawled pages for named
// people and their titles using structured/verifiable signals only (JSON-LD
// Person data, name+title text patterns, image captions, personal LinkedIn
// links). This is "grounding" data for the research agent — the same role
// buildWebsiteDigest already plays for emails/phones — not a replacement for
// it. Every candidate carries a `source_url` and a verbatim `evidence` quote
// so a claim like "Jane Doe is CEO" can always be traced back to the exact
// page and text it came from.

const TITLE_KEYWORDS =
  /\b(chief\s+\w+(\s+\w+)?\s+officer|CEO|CTO|CFO|COO|CMO|CIO|CPO|CISO|CRO|President|Vice\s+President|VP\b|Founder|Co-?Founder|Chairman|Chairwoman|Chairperson|Chair\b|Managing\s+Director|Executive\s+Director|Director\b|Head\s+of\s+\w+|Partner\b|Principal\b|General\s+Manager|Owner\b)/i;

const NAME = "[A-Z][a-zA-Z'.-]+(?:\\s+[A-Z](?:[a-zA-Z'.-]+|\\.)){1,2}";
const NAME_TITLE_LINE = new RegExp(`^(${NAME})\\s*[,\\-–—|:]\\s*(.{2,80})$`);
const PERSON_LINKEDIN = /linkedin\.com\/in\//i;
const PLAUSIBLE_NAME = /^[A-Z][a-zA-Z'.-]+(\s+[A-Z][a-zA-Z'.-]+){1,2}$/;

// Casual team-page captions often lead with a verb, not the name itself
// ("Meet Eron, our Head of Support") — without stripping this, "Meet" gets
// captured as part of the name. If what's left after stripping no longer
// has a first+last name (e.g. just "Eron"), NAME_TITLE_LINE correctly fails
// to match and the candidate is dropped rather than mis-extracted.
const LEADING_FILLER = /^(meet|say hello to|introducing|this is|here'?s)\s+/i;

// Captions like "our Head of Support" carry a possessive article the actual
// job title doesn't include.
const TITLE_ARTICLE_PREFIX = /^(our|the|a)\s+/i;

function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

// Matches lines like "Jane Doe, Chief Executive Officer" or
// "Jane Doe — Co-Founder & CTO". Requires an explicit leadership-title
// keyword so we don't turn every "Name, some phrase" line into a candidate.
function matchNameTitle(rawText) {
  const text = cleanText(rawText).replace(LEADING_FILLER, "");
  if (!text || text.length > 140) return null;

  const match = text.match(NAME_TITLE_LINE);
  if (!match) return null;

  const [, name, titlePart] = match;
  if (!TITLE_KEYWORDS.test(titlePart)) return null;

  return {
    name: cleanText(name),
    title: cleanText(titlePart).replace(TITLE_ARTICLE_PREFIX, ""),
  };
}

function fromTextLines(lines, page) {
  const found = [];
  for (const raw of lines) {
    const line = cleanText(raw);
    const parsed = matchNameTitle(line);
    if (!parsed) continue;

    found.push({
      ...parsed,
      photo_url: null,
      linkedin_url: null,
      email: null,
      phone: null,
      source_url: page.url,
      method: "text-pattern",
      evidence: line,
    });
  }
  return found;
}

// Team-page grids very often carry "Name, Title" as the image's alt text —
// the alt text plus the image src is direct, checkable proof.
function fromImageAlts(page) {
  const found = [];
  for (const img of page.images || []) {
    const alt = cleanText(img.alt);
    const parsed = matchNameTitle(alt);
    if (!parsed) continue;

    found.push({
      ...parsed,
      photo_url: img.src || null,
      linkedin_url: null,
      email: null,
      phone: null,
      source_url: page.url,
      method: "image-alt",
      evidence: `img alt="${alt}"`,
    });
  }
  return found;
}

function collectPersonNodes(node, results) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    node.forEach((child) => collectPersonNodes(child, results));
    return;
  }

  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  if (types.includes("Person") && node.name) {
    results.push(node);
  }

  for (const key of Object.keys(node)) {
    if (key === "@type") continue;
    collectPersonNodes(node[key], results);
  }
}

// Some sites mistakenly (or lazily) tag their own Organization node as
// "@type": "Person" — e.g. { "@type": "Person", "name": "Acme Inc",
// "sameAs": ["https://linkedin.com/company/acme"] }, no jobTitle at all.
// Without this check that gets harvested as a "leader" named after the
// company itself. Require real person-level evidence — a job title, or a
// personal (not company) LinkedIn profile — before trusting the node.
function isPlausiblePerson(person) {
  const sameAs = Array.isArray(person.sameAs)
    ? person.sameAs
    : person.sameAs
      ? [person.sameAs]
      : [];
  const hasPersonalLinkedIn = sameAs.some(
    (url) => typeof url === "string" && PERSON_LINKEDIN.test(url),
  );
  const hasJobTitle = Boolean(cleanText(person.jobTitle));

  return hasJobTitle || hasPersonalLinkedIn;
}

// schema.org Person markup is the strongest possible proof — it's
// machine-readable data the site itself published, not text we pattern-matched.
function fromJsonLd(page) {
  const personNodes = [];
  for (const doc of page.jsonLd || []) collectPersonNodes(doc, personNodes);

  return personNodes.filter(isPlausiblePerson).map((person) => {
    const sameAs = Array.isArray(person.sameAs)
      ? person.sameAs
      : person.sameAs
        ? [person.sameAs]
        : [];
    const linkedin = sameAs.find((url) => typeof url === "string" && PERSON_LINKEDIN.test(url));

    return {
      name: cleanText(person.name),
      title: cleanText(person.jobTitle) || null,
      photo_url: typeof person.image === "string" ? person.image : person.image?.url || null,
      linkedin_url: linkedin || null,
      email: person.email ? String(person.email).replace(/^mailto:/i, "") : null,
      phone: person.telephone || null,
      source_url: page.url,
      method: "json-ld",
      evidence: JSON.stringify(person),
    };
  });
}

// A personal LinkedIn profile link whose anchor text is itself a plausible
// human name is strong proof of both the name and the affiliation-worthy link.
function fromLinkedInLinks(page) {
  const found = [];
  for (const link of page.links || []) {
    if (!link.href || !PERSON_LINKEDIN.test(link.href)) continue;

    const text = cleanText(link.text);
    if (!PLAUSIBLE_NAME.test(text)) continue;

    found.push({
      name: text,
      title: null,
      photo_url: null,
      linkedin_url: link.href,
      email: null,
      phone: null,
      source_url: page.url,
      method: "linkedin-link",
      evidence: `link text "${text}" -> ${link.href}`,
    });
  }
  return found;
}

export function extractPageLeadership(page) {
  if (page.error) return [];

  const textLines = [
    ...(page.paragraphs || []),
    ...(page.lists || []).flat(),
    ...Object.values(page.headings || {}).flat(),
  ];

  // JSON-LD first: it's the most reliable source, so it wins ties during
  // rollup merging (first non-null value per field is kept).
  return [
    ...fromJsonLd(page),
    ...fromImageAlts(page),
    ...fromTextLines(textLines, page),
    ...fromLinkedInLinks(page),
  ];
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Merges same-person candidates found across multiple pages (e.g. a name+
// title on /team plus a LinkedIn link on /about) into one record, keeping
// every source page and every piece of evidence so the merge itself stays
// auditable.
export function buildLeadershipRollup(pages) {
  const byName = new Map();

  for (const page of pages || []) {
    for (const candidate of extractPageLeadership(page)) {
      const key = normalizeName(candidate.name);
      if (!key) continue;

      const proof = {
        source_url: candidate.source_url,
        method: candidate.method,
        quote: candidate.evidence,
      };

      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, {
          name: candidate.name,
          title: candidate.title,
          photo_url: candidate.photo_url,
          linkedin_url: candidate.linkedin_url,
          email: candidate.email,
          phone: candidate.phone,
          source_urls: [candidate.source_url],
          evidence: [proof],
        });
        continue;
      }

      existing.title ??= candidate.title;
      existing.photo_url ??= candidate.photo_url;
      existing.linkedin_url ??= candidate.linkedin_url;
      existing.email ??= candidate.email;
      existing.phone ??= candidate.phone;
      if (!existing.source_urls.includes(candidate.source_url)) {
        existing.source_urls.push(candidate.source_url);
      }
      existing.evidence.push(proof);
    }
  }

  return [...byName.values()];
}
