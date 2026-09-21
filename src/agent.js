import { Agent } from "@openai/agents";
import { z } from "zod";

import { braveSearchTool } from "./tools/braveSearch.js";
import { fetchWebsiteTool } from "./tools/fetchWebsite.js";
import { apolloFindCompanyTool } from "./tools/apollo.js";

const PersonSchema = z.object({
  name: z.string().nullable(),
  role: z.string().nullable(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
  photo_url: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  // Populated only when published directly on the company's own site (e.g. a
  // team/leadership/contact page) — distinct from the Apollo-sourced
  // `contacts` field, which is populated deterministically after the agent
  // runs. Never fabricate these; leave null if not explicitly found.
  email: z.string().nullable(),
  phone: z.string().nullable(),
  // Required proof: the exact page a claim about this person came from.
  // Every entry in founders/executives/key_people must carry one — if you
  // can't cite where a name, title, bio, photo, or LinkedIn URL came from,
  // leave that field null (or drop the person) rather than guess.
  source_url: z.string().nullable(),
});

const ProductSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  source_url: z.string().nullable(),
});

const FundingRoundSchema = z.object({
  round: z.string().nullable(),
  amount: z.string().nullable(),
  date: z.string().nullable(),
  investors: z.array(z.string()),
  source_url: z.string().nullable(),
});

const NewsItemSchema = z.object({
  title: z.string().nullable(),
  summary: z.string().nullable(),
  date: z.string().nullable(),
  url: z.string().nullable(),
});

const TechnologySchema = z.object({
  name: z.string().nullable(),
  category: z.string().nullable(),
  source_url: z.string().nullable(),
});

const HiringSignalSchema = z.object({
  signal: z.string().nullable(),
  description: z.string().nullable(),
  source_url: z.string().nullable(),
  date: z.string().nullable(),
});

const SocialProfileSchema = z.object({
  platform: z.string().nullable(),
  url: z.string().nullable(),
});

const SourceSchema = z.object({
  title: z.string().nullable(),
  url: z.string().nullable(),
  source_type: z.string().nullable(),
  published_at: z.string().nullable(),
});

// Mirrors src/models/Company.js so the agent's output can be saved as-is.
// Fields owned by the server (website, domain, research_status,
// research_errors, last_researched_at) are intentionally excluded here.
// `contacts` and Apollo firmographic fields (apollo_organization_id,
// annual_revenue, phone) are also excluded: they're populated deterministically
// by enrichCompanyWithApollo() after the agent runs, not by the LLM, so
// completeness never depends on the model remembering to call every tool.
export const CompanyResearchOutput = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  industry: z.string().nullable(),
  sub_industries: z.array(z.string()),
  founded_year: z.number().nullable(),
  company_size: z.string().nullable(),
  employee_count: z.number().nullable(),

  location: z.object({
    headquarters: z.string().nullable(),
    other_locations: z.array(z.string()),
  }),

  products: z.array(ProductSchema),
  services: z.array(ProductSchema),

  target_customers: z.array(z.string()),
  customer_types: z.array(z.string()),
  industries_served: z.array(z.string()),
  business_model: z.string().nullable(),

  founders: z.array(PersonSchema),
  executives: z.array(PersonSchema),
  key_people: z.array(PersonSchema),

  funding: z.array(FundingRoundSchema),
  total_funding: z.string().nullable(),

  competitors: z.array(z.string()),

  technologies: z.array(TechnologySchema),

  hiring_signals: z.array(HiringSignalSchema),

  recent_news: z.array(NewsItemSchema),

  social_profiles: z.array(SocialProfileSchema),

  sources: z.array(SourceSchema),

  research_summary: z.string().nullable(),
});

export const companyResearchAgent = new Agent({
  name: "Company Research Agent",

  model: "gpt-5.4",

  instructions: `
You are an expert company research agent.

Your job is to research a company from its website URL.

Follow this process:

1. The user message usually already includes pre-crawled content from multiple pages of the company's own website (home, about, team, leadership, contact, etc) — read it closely before doing anything else, since it's your primary source. Only call fetch_company_website for the homepage if no pre-crawled content was provided, or for a specific page you still need that wasn't covered.

   If a "VERIFIED LEADERSHIP" section is present, it was extracted directly from the site's own markup (schema.org Person data, name+title captions, LinkedIn profile links) — treat every entry as high-confidence and carry its name, title, source_url, photo_url, linkedin_url, email, and phone through to founders/executives/key_people as given. Do not drop, rename, or contradict a verified entry without a specific reason found elsewhere in the content. You may still add bio (from surrounding page text) or add people not in that section if the rest of the page content clearly supports it, but every added or edited detail still needs its own source_url.
2. Understand what the company does.
3. Identify missing important information.
4. Use Brave Search to find additional public information.
5. Use Apollo (apollo_find_company) to verify/enrich firmographic data (industry, employee count, revenue, technologies, HQ) using the company's domain. Use this only as supporting context for the fields below — do not fabricate a source_url for it (e.g. never invent an "apollo://..." URL); cite the company's real website instead.
6. Cross-check important facts using multiple sources when possible.
7. Never invent information.
8. If information cannot be verified, use null (or an empty array for list fields).
9. Keep the source URL for important facts.
10. Return a structured company profile matching the output schema exactly.

Note: the contacts field (people with verified emails/phones from Apollo) is populated automatically after your research completes, by the server — do not try to find or output that field yourself. That is separate from founders/executives/key_people below: for those, if the pre-crawled website content includes an "Emails found on this page" / "Phone numbers found on this page" line for a team/leadership/contact page, or an email/phone appears directly next to a named person, attach it to that person's email/phone fields. Never guess or construct an email/phone that wasn't explicitly present in the source content.

Research and populate these fields:

- name
- description
- industry
- sub_industries
- founded_year
- company_size (e.g. "1-10", "11-50", "51-200")
- employee_count (a number, if a reliable figure is available)
- location.headquarters
- location.other_locations
- products (name, description, source_url)
- services (name, description, source_url)
- target_customers
- customer_types
- industries_served
- business_model
- founders (name, role, title, bio, photo_url, linkedin_url, email, phone, source_url)
- executives (name, role, title, bio, photo_url, linkedin_url, email, phone, source_url)
- key_people (name, role, title, bio, photo_url, linkedin_url, email, phone, source_url)
- funding (round, amount, date, investors, source_url)
- total_funding
- competitors
- technologies (name, category, source_url)
- hiring_signals (signal, description, source_url, date)
- recent_news (title, summary, date, url)
- social_profiles (platform, url)
- sources (title, url, source_type, published_at) for every important fact used
- research_summary: a short (2-4 sentence) plain-English summary of the company

Remember:
Only use publicly available information.
Do not claim something is true if there is insufficient evidence.
`,

  tools: [fetchWebsiteTool, braveSearchTool, apolloFindCompanyTool],

  outputType: CompanyResearchOutput,
});
