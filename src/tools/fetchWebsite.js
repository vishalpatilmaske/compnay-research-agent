import { tool } from "@openai/agents";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";

export const fetchWebsiteTool = tool({
  name: "fetch_company_website",

  description:
    "Fetch and extract readable text from a public company website URL.",

  parameters: z.object({
    url: z.string().describe("The full company website URL"),
  }),

  async execute({ url }) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 CompanyResearchBot/1.0",
        },
      });

      const $ = cheerio.load(response.data);

      $("script, style, noscript").remove();

      const title = $("title").text().trim();

      const text = $("body").text().replace(/\s+/g, " ").trim();

      return JSON.stringify({
        url,
        title,
        content: text.slice(0, 30000),
      });
    } catch (error) {
      return JSON.stringify({
        error: `Unable to fetch website: ${error.message}`,
      });
    }
  },
});
