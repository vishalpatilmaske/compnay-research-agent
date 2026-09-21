import { tool } from "@openai/agents";
import { z } from "zod";

import { braveSearch } from "../services/braveSearch.js";

export const braveSearchTool = tool({
  name: "brave_search",

  description:
    "Search the internet using Brave Search to find public information about a company.",

  parameters: z.object({
    query: z.string().describe("The search query"),
  }),

  async execute({ query }) {
    return JSON.stringify(await braveSearch(query));
  },
});
