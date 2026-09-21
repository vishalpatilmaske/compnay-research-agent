import { tool } from "@openai/agents";
import { z } from "zod";

import {
  findApolloOrganization,
  findApolloPeople,
  revealApolloPerson,
} from "../services/apollo.js";

export const apolloFindCompanyTool = tool({
  name: "apollo_find_company",

  description:
    "Look up a company in Apollo.io by domain or name to get verified firmographic data (industry, employee count, revenue, technologies, HQ location, social links).",

  parameters: z.object({
    domain: z
      .string()
      .nullable()
      .describe("The company's website domain, e.g. example.com"),
    name: z
      .string()
      .nullable()
      .describe("The company name, used when the domain is not known"),
  }),

  async execute({ domain, name }) {
    try {
      const organization = await findApolloOrganization({ domain, name });

      if (!organization) {
        return JSON.stringify({
          error: "No organization found in Apollo for the given domain/name.",
        });
      }

      return JSON.stringify(organization);
    } catch (error) {
      return JSON.stringify({
        error: `Apollo organization lookup failed: ${error.response?.status || ""} ${error.message}`,
      });
    }
  },
});

export const apolloFindPeopleTool = tool({
  name: "apollo_find_people",

  description:
    "Search Apollo.io for contacts (people) working at a company, optionally filtered by job titles. This is free (no credits spent) but returns privacy-masked results: partial name, title, and flags for whether an email/phone exists. Use apollo_reveal_contact on a specific apollo_id to unlock the full email/phone for a chosen contact.",

  parameters: z.object({
    domain: z
      .string()
      .nullable()
      .describe("The company's website domain to search contacts for"),
    organization_name: z
      .string()
      .nullable()
      .describe("The company name, used when the domain is not known"),
    titles: z
      .array(z.string())
      .describe(
        "Job titles or keywords to filter contacts by, e.g. ['CEO', 'Head of Marketing']. Pass an empty array to search all seniorities.",
      ),
    limit: z
      .number()
      .describe("Maximum number of contacts to return (max 25)"),
  }),

  async execute({ domain, organization_name, titles, limit }) {
    try {
      const people = await findApolloPeople({
        domain,
        organizationName: organization_name,
        titles,
        limit,
      });

      return JSON.stringify(people);
    } catch (error) {
      return JSON.stringify({
        error: `Apollo people search failed: ${error.response?.status || ""} ${error.message}`,
      });
    }
  },
});

export const apolloRevealContactTool = tool({
  name: "apollo_reveal_contact",

  description:
    "Reveal full details (name, email, seniority, city/state/country) for a specific Apollo contact found via apollo_find_people. This SPENDS Apollo credits. Call this once per contact returned by apollo_find_people so every contact ends up with full details. Phone number reveal only works if an APOLLO_WEBHOOK_URL is configured on the server (Apollo delivers phone numbers asynchronously to a webhook) — if not configured, phone stays null even when reveal_phone is true.",

  parameters: z.object({
    apollo_id: z
      .string()
      .describe("The apollo_id of the person to reveal, from apollo_find_people results"),
    reveal_phone: z
      .boolean()
      .describe(
        "Whether to also attempt to reveal the phone number (requires APOLLO_WEBHOOK_URL to be configured; otherwise ignored)",
      ),
  }),

  async execute({ apollo_id, reveal_phone }) {
    try {
      const contact = await revealApolloPerson({
        apolloId: apollo_id,
        revealPhone: reveal_phone,
      });

      if (!contact) {
        return JSON.stringify({ error: "No contact found for that apollo_id." });
      }

      return JSON.stringify(contact);
    } catch (error) {
      return JSON.stringify({
        error: `Apollo contact reveal failed: ${error.response?.status || ""} ${error.message}`,
      });
    }
  },
});
