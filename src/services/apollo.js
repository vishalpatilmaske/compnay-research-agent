import axios from "axios";

const APOLLO_BASE_URL = "https://api.apollo.io/v1";

function apolloHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-api-key": process.env.APOLLO_API_KEY,
  };
}

// Looks up a company in Apollo by domain (preferred) or name.
// Returns a normalized organization object, or null if nothing was found.
export async function findApolloOrganization({ domain, name }) {
  const params = {};
  if (domain) params.domain = domain;
  if (name) params.organization_name = name;

  const response = await axios.get(`${APOLLO_BASE_URL}/organizations/enrich`, {
    headers: apolloHeaders(),
    params,
    timeout: 15000,
  });

  const org = response.data?.organization;

  if (!org) return null;

  return {
    apollo_id: org.id ?? null,
    name: org.name ?? null,
    website_url: org.website_url ?? null,
    domain: org.primary_domain ?? null,
    industry: org.industry ?? null,
    keywords: org.keywords ?? [],
    employee_count: org.estimated_num_employees ?? null,
    annual_revenue: org.annual_revenue ?? null,
    founded_year: org.founded_year ?? null,
    headquarters: [org.city, org.state, org.country].filter(Boolean).join(", ") || null,
    linkedin_url: org.linkedin_url ?? null,
    twitter_url: org.twitter_url ?? null,
    facebook_url: org.facebook_url ?? null,
    phone: org.phone ?? null,
    technologies: org.technology_names ?? [],
    short_description: org.short_description ?? null,
  };
}

// Searches Apollo for people/contacts at a company, optionally filtered by job titles.
// This uses Apollo's search endpoint, which does NOT spend credits but returns
// privacy-masked results (obfuscated last name, no email/phone). Use
// revealApolloPerson() on a specific apollo_id to unlock full contact details
// (this spends Apollo credits, so do it selectively for high-value contacts).
export async function findApolloPeople({ domain, organizationName, titles, limit }) {
  const body = {
    page: 1,
    per_page: Math.min(limit || 10, 25),
  };

  if (domain) body.q_organization_domains = domain;
  if (organizationName) body.organization_names = [organizationName];
  if (titles && titles.length > 0) body.person_titles = titles;

  const response = await axios.post(`${APOLLO_BASE_URL}/mixed_people/api_search`, body, {
    headers: apolloHeaders(),
    timeout: 15000,
  });

  const people = response.data?.people || [];

  return people.map((person) => ({
    apollo_id: person.id ?? null,
    name:
      [person.first_name, person.last_name_obfuscated].filter(Boolean).join(" ") ||
      null,
    title: person.title ?? null,
    seniority: person.seniority ?? null,
    email: null,
    email_status: person.has_email ? "available_not_revealed" : null,
    linkedin_url: null,
    phone: person.has_direct_phone === "Yes" ? "available_not_revealed" : null,
    city: null,
    state: null,
    country: null,
    organization_name: person.organization?.name ?? null,
    source: "apollo",
  }));
}

// Reveals full contact details (name, email, and optionally phone) for a
// specific Apollo person by id. This spends Apollo credits per call.
// Apollo requires a webhook_url whenever reveal_phone_number is requested
// (phone numbers are delivered async to that webhook), so phone reveal is
// only attempted when APOLLO_WEBHOOK_URL is configured — otherwise it's
// silently skipped so the email reveal still succeeds.
export async function revealApolloPerson({ apolloId, revealPhone = false }) {
  const body = {
    id: apolloId,
    reveal_personal_emails: true,
  };

  if (revealPhone && process.env.APOLLO_WEBHOOK_URL) {
    body.reveal_phone_number = true;
    body.webhook_url = process.env.APOLLO_WEBHOOK_URL;
  }

  const response = await axios.post(`${APOLLO_BASE_URL}/people/match`, body, {
    headers: apolloHeaders(),
    timeout: 15000,
  });

  const person = response.data?.person;

  if (!person) return null;

  return {
    apollo_id: person.id ?? null,
    name: person.name ?? null,
    title: person.title ?? null,
    seniority: person.seniority ?? null,
    email: person.email ?? null,
    email_status: person.email_status ?? null,
    linkedin_url: person.linkedin_url ?? null,
    phone: person.sanitized_phone ?? null,
    city: person.city ?? null,
    state: person.state ?? null,
    country: person.country ?? null,
    organization_name: person.organization?.name ?? null,
    source: "apollo",
  };
}
