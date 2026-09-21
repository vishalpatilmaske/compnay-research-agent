import axios from "axios";

const REQUEST_TIMEOUT = 10000;
const USER_AGENT = "CompanyResearchBot";

async function fetchText(url) {
  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: { "User-Agent": `Mozilla/5.0 ${USER_AGENT}/1.0` },
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }
    return null;
  } catch {
    return null;
  }
}

// Groups robots.txt into { agents, rules } blocks. Per spec, consecutive
// User-agent lines with no rules between them share one group; a
// Disallow/Allow line closes the group, so the next User-agent line (if
// any) starts a new one.
function parseRobotsGroups(robotsTxt) {
  const groups = [];
  let current = null;

  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;

    const directive = match[1].toLowerCase();
    const value = match[2].trim();

    if (directive === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((directive === "disallow" || directive === "allow") && current) {
      current.rules.push({ type: directive, path: value });
    }
  }

  return groups;
}

function pickGroupForAgent(groups, userAgent) {
  const lowerAgent = userAgent.toLowerCase();

  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && lowerAgent.includes(a)));
  if (specific) return specific;

  return groups.find((g) => g.agents.includes("*")) || null;
}

// Converts a robots.txt path pattern (`*` wildcard, optional trailing `$`
// end-anchor) into a RegExp anchored at the start of the URL path.
function patternToRegExp(path) {
  if (path === "") return /^/; // an empty Disallow means "allow everything"

  const endAnchored = path.endsWith("$");
  const body = endAnchored ? path.slice(0, -1) : path;

  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${escaped}${endAnchored ? "$" : ""}`);
}

// Fetches and parses robots.txt into the rule set that applies to this
// crawler. Fails open (no rules => everything allowed) rather than blocking
// a whole crawl just because robots.txt was missing or unreachable.
export async function fetchRobotsRules(baseUrl, userAgent = USER_AGENT) {
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();
  const robotsTxt = await fetchText(robotsUrl);

  if (!robotsTxt || typeof robotsTxt !== "string") {
    return { rules: [] };
  }

  const group = pickGroupForAgent(parseRobotsGroups(robotsTxt), userAgent);

  const rules = (group?.rules || []).map((rule) => ({
    type: rule.type,
    path: rule.path,
    pattern: patternToRegExp(rule.path),
  }));

  return { rules };
}

// Standard robots.txt precedence: among the rules whose pattern matches the
// URL's path, the one with the longest `path` wins; ties and "no match"
// both default to allowed.
export function isAllowedByRobots(url, { rules }) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return true;
  }

  let best = null;
  for (const rule of rules) {
    if (rule.pattern.test(pathname) && (!best || rule.path.length > best.path.length)) {
      best = rule;
    }
  }

  return !best || best.type === "allow";
}
