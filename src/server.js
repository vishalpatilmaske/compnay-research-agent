import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { run } from "@openai/agents";

import { companyResearchAgent } from "./agent.js";
import Company from "./models/Company.js";
import { revealApolloPerson } from "./services/apollo.js";
import { enrichCompanyWithApollo } from "./services/companyApolloEnrichment.js";
import { websiteAdapter } from "./adapters/website/website.adapter.js";
import { buildWebsiteDigest } from "./adapters/website/website.digest.js";

dotenv.config();

const app = express();

app.use(express.json());

// MongoDB
await mongoose.connect(process.env.MONGODB_URI);

console.log("MongoDB connected");

// home route
app.get("/", (_req, res) => {
  res.send("Company Research Agent API");
});

// Research company
app.post("/api/research-company", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      message: "Company URL is required",
    });
  }

  let domain = null;
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return res.status(400).json({
      success: false,
      message: "Company URL is invalid",
    });
  }

  try {
    console.log("Researching:", url);

    await Company.findOneAndUpdate(
      { website: url },
      { website: url, domain, research_status: "researching" },
      { upsert: true },
    );

    // Pre-crawl the site (home + about/team/leadership/contact/etc, up to
    // maxPages) so the agent sees multi-page content directly instead of
    // depending on it deciding to fetch beyond the homepage. Never lets a
    // crawl failure block research — the agent can still fall back to
    // fetch_company_website on just the homepage.
    let websiteDigest = null;
    try {
      const crawlResult = await websiteAdapter(url, { maxPages: 12 });
      websiteDigest = buildWebsiteDigest(crawlResult);
      console.log(`Pre-crawled ${websiteDigest.pageCount} pages for ${domain}`);
    } catch (error) {
      console.error("Website pre-crawl failed, agent will fetch homepage only:", error.message);
    }

    const result = await run(
      companyResearchAgent,
      `
      Research this company:

      ${url}
      ${
        websiteDigest && websiteDigest.pageCount > 0
          ? `
      Here is pre-crawled content from ${websiteDigest.pageCount} pages of the company's own website (home, about, team, leadership, contact, etc). Use it as your primary source, including for founders/executives/key_people and any email/phone published on the site. Only call fetch_company_website for pages not already covered here.

      ${websiteDigest.digestText}
      `
          : ""
      }

      Return the complete company research profile.
      `,
    );

    console.log("Agent completed");

    const companyData = result.finalOutput;

    // The agent's own contacts/firmographics are best-effort context for its
    // narrative fields (description, business_model, etc). The authoritative,
    // complete Apollo data (org firmographics + fully-revealed contacts) is
    // always fetched deterministically below, so it never depends on the LLM
    // remembering to call every Apollo tool for every contact.
    const { contacts: _agentContacts, ...companyDataWithoutContacts } = companyData;

    await Company.findOneAndUpdate(
      {
        website: url,
      },
      {
        ...companyDataWithoutContacts,

        website: url,

        domain,

        research_status: "completed",

        research_errors: [],

        last_researched_at: new Date(),
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    );

    console.log("Enriching with Apollo:", domain);

    const { company } = await enrichCompanyWithApollo({
      website: url,
      domain,
      limit: 25,
    }).catch((error) => {
      console.error("Apollo enrichment failed:", error.message);
      return { company: null };
    });

    const finalCompany = company || (await Company.findOne({ website: url }));

    res.json({
      success: true,
      company: finalCompany,
    });
  } catch (error) {
    console.error(error);

    await Company.findOneAndUpdate(
      { website: url },
      {
        website: url,
        domain,
        research_status: "failed",
        $push: { research_errors: error.message },
      },
      { upsert: true },
    ).catch((updateError) => {
      console.error("Failed to record research error:", updateError);
    });

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Enrich a company with Apollo firmographic data + contacts, and store them.
app.post("/api/companies/apollo-enrich", async (req, res) => {
  const { website, titles, limit } = req.body;

  if (!website) {
    return res.status(400).json({
      success: false,
      message: "Company website is required",
    });
  }

  let domain = null;
  try {
    domain = new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return res.status(400).json({
      success: false,
      message: "Company website is invalid",
    });
  }

  try {
    const { organization, company } = await enrichCompanyWithApollo({
      website,
      domain,
      titles: titles || [],
      limit: limit || 10,
    });

    res.json({
      success: true,
      organization,
      company,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Reveal a specific contact's full email/phone (spends Apollo credits) and
// persist the revealed details onto the matching contact already stored on
// the company document.
app.post("/api/companies/apollo-reveal-contact", async (req, res) => {
  const { website, apollo_id, reveal_phone } = req.body;

  if (!website || !apollo_id) {
    return res.status(400).json({
      success: false,
      message: "website and apollo_id are required",
    });
  }

  try {
    const revealed = await revealApolloPerson({
      apolloId: apollo_id,
      revealPhone: !!reveal_phone,
    });

    if (!revealed) {
      return res.status(404).json({
        success: false,
        message: "No contact found in Apollo for that apollo_id",
      });
    }

    const company = await Company.findOneAndUpdate(
      { website, "contacts.apollo_id": apollo_id },
      { $set: { "contacts.$": revealed } },
      { new: true },
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company/contact not found. Run apollo-enrich first.",
      });
    }

    res.json({
      success: true,
      contact: revealed,
      company,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

const PORT = process.env.PORT || 5050;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
