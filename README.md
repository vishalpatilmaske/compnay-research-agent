# Company Research Agent

An Express API that researches a company from its website URL. It builds a sourced company profile, determines its current leadership with confidence scores, and persists both to MongoDB. LLM agents (OpenAI Agents SDK) *gather* candidate evidence from the company website and from public sources: SEC EDGAR, UK Companies House, India MCA (data.gov.in), Wikidata, Brave Search, and Apollo.io. Deterministic code under `src/validation/` then *decides* what to accept, merge, and score. Every fact keeps its `source_url` and `retrieved_at`, and conflicting observations are kept rather than silently resolved. See `.specify/memory/constitution.md`.

## Prerequisites

- **Node.js 20+** (developed on 22). The project uses ES modules and top-level `await`.
- **MongoDB** reachable from `MONGODB_URI` (for example a local `mongod` on `127.0.0.1:27017`).
- **Playwright Chromium**, used by the website crawler: `npx playwright install chromium`.
- API credentials for the sources you want to use (see below). Only `MONGODB_URI` and `OPENAI_API_KEY` are required to boot and run research.

## Install

```bash
git clone <repo-url> company-research-agent
cd company-research-agent
npm install
npx playwright install chromium
touch .env          # then fill in the variables below
```

`.env` is git-ignored. Never commit real keys, and never expose them to client-side code.

## Environment variables

| Variable | Used by | Required? | Purpose / behavior when unset |
|---|---|---|---|
| `MONGODB_URI` | `src/config/db.js` | **Required** | MongoDB connection string. The server connects before it listens, and exits if it can't connect. |
| `PORT` | `src/server.js`, endpoint test scripts | Optional (default `5050`) | HTTP port. |
| `OPENAI_API_KEY` | `src/agents/*` (read by `@openai/agents`) | **Required** for research | Runs the company research agent and the leadership discovery agent. |
| `SEC_USER_AGENT` | `src/adapters/sec` | Required for SEC | SEC requires a declared UA with a real contact, e.g. `"MyApp research@example.com"`. When unset, SEC calls throw, and leadership research carries on without SEC. |
| `COMPANIES_HOUSE_API_KEY` | `src/adapters/companiesHouse` | Required for UK companies | Free key from the Companies House developer hub. When unset, the adapter returns `status: "NOT_CONFIGURED"` and is skipped. |
| `DATA_GOV_API_KEY` | `src/adapters/mca` | Required for Indian companies | data.gov.in API key for MCA company master data. When unset, MCA lookups fail and are skipped. |
| `DATA_GOV_MCA_RESOURCE_IDS` | `src/adapters/mca` | Required with the above | Comma-separated data.gov.in resource IDs to query. |
| `DATA_GOV_MCA_RESOURCE_ID` | `src/adapters/mca` | Optional | Single-ID fallback, read only when `DATA_GOV_MCA_RESOURCE_IDS` is unset. |
| `BRAVE_SEARCH_API_KEY` | `src/adapters/brave` | Recommended | Web search for the agents and for leadership/MCA discovery. When unset, Brave returns errors, and leadership research ignores failed searches. |
| `APOLLO_API_KEY` | `src/adapters/apollo` | Optional | Firmographics and contacts. Used by the Apollo endpoints, the company agent's Apollo tool, and the enrichment step of `research-company`. If enrichment fails, it is logged and the request still succeeds. |
| `APOLLO_WEBHOOK_URL` | `src/adapters/apollo` | Optional | Needed only for `reveal_phone: true`, because Apollo delivers phone numbers asynchronously to this webhook. Without it, phone reveal is skipped. |
| `OPENCORPORATES_API_KEY` | `src/adapters/opencorporates` | Optional | Used only by `npm run test:opencorporates`. No pipeline calls it yet. When unset, the adapter reports a missing-key error. |

Example `.env` (placeholders only):

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/company-research
PORT=5050
OPENAI_API_KEY=sk-...
SEC_USER_AGENT="YourApp you@example.com"
COMPANIES_HOUSE_API_KEY=...
DATA_GOV_API_KEY=...
DATA_GOV_MCA_RESOURCE_IDS=resource-id-1,resource-id-2
BRAVE_SEARCH_API_KEY=...
APOLLO_API_KEY=...
# APOLLO_WEBHOOK_URL=https://your-host/apollo-webhook
# OPENCORPORATES_API_KEY=...
```

## Run

```bash
npm start      # node src/server.js
npm run dev    # node --watch src/server.js (restarts on file changes)
```

Expected output: `MongoDB connected`, then `Server running on http://localhost:5050`.

**Always run commands from the project root.** Adapters write raw and cached JSON to `data/<source>/`, using paths relative to the working directory. Examples: `data/websites/`, `data/sec/`, `data/mca/`, `data/companiesHouse/`, `data/opencorporates/`, `data/leadership/raw/`, and `data/leadership/reports/`. `data/` is git-ignored.

## API

All request bodies are JSON (`Content-Type: application/json`). Unexpected failures return `500 { "success": false, "message": "<error message>" }`.

### `GET /`

Health check. Returns the text `Company Research Agent API`.

### `POST /api/research-company`

Runs the company research agent on a website. It also crawls the site, enriches the company from Apollo (best effort), and upserts the `Company` document (`research_status`: `researching` → `completed`/`failed`).

| Field | Type | Required |
|---|---|---|
| `url` | string (absolute URL) | yes |

```bash
curl -X POST http://localhost:5050/api/research-company \
  -H 'Content-Type: application/json' -d '{"url":"https://www.example.com"}'
```

- `200 { "success": true, "company": { …Company document… } }`
- `400 "Company URL is required"` / `400 "Company URL is invalid"`

Details: `specs/001-company-leadership-research/contracts/research-company.md`.

### `POST /api/leadership-research`

Determines current leadership with confidence scoring. It gathers evidence from the website, SEC (US), Companies House (GB), MCA (IN), Brave, and Wikidata, runs the discovery agent, and then resolves and scores the evidence deterministically. It doesn't read or write a `Company` document.

| Field | Type | Required |
|---|---|---|
| `companyName` | string | yes |
| `domain` | string (domain or URL) | no |
| `country` | ISO code, e.g. `US`, `GB`, `IN` | no (guessed from the domain) |

```bash
curl -X POST http://localhost:5050/api/leadership-research \
  -H 'Content-Type: application/json' \
  -d '{"companyName":"Tesla","domain":"tesla.com","country":"US"}'
```

- `200 { "success": true, "report": { company, leadership, validation }, "sourcesChecked": [...], "savedTo": { raw, report } }`
- `400 "companyName is required"`

Details: `specs/001-company-leadership-research/contracts/leadership-research.md`.

### `POST /api/research`

Unified research. It runs company research and leadership research concurrently for one URL, validates and persists both (linked by `company_id`), and returns both. Each half reports its own `status` (`completed`/`failed`).

| Field | Type | Required |
|---|---|---|
| `url` | string (absolute URL) | yes |

```bash
curl -X POST http://localhost:5050/api/research \
  -H 'Content-Type: application/json' -d '{"url":"https://www.tesla.com"}'
```

- `200 { "success": true, "company_id": "...", "companyResearch": { status, profile, error }, "leadershipResearch": { status, report, error } }`
- `400 "Company URL is required"` / `400 "Company URL is invalid"`

Details: `specs/002-unified-research-endpoint/contracts/unified-research.md`.

### `POST /api/companies/apollo-enrich`

Enriches a company with Apollo firmographics and contacts, and stores them on the `Company` document. **This spends Apollo credits.**

| Field | Type | Required |
|---|---|---|
| `website` | string (absolute URL) | yes |
| `titles` | string[] (job titles to search) | no (default `[]`) |
| `limit` | number (max contacts) | no (default `10`) |

```bash
curl -X POST http://localhost:5050/api/companies/apollo-enrich \
  -H 'Content-Type: application/json' -d '{"website":"https://www.example.com","titles":["CEO","CTO"],"limit":5}'
```

- `200 { "success": true, "organization": {...}, "company": {...} }`
- `400 "Company website is required"` / `400 "Company website is invalid"`

### `POST /api/companies/apollo-reveal-contact`

Reveals a stored contact's full email (and phone, if requested and `APOLLO_WEBHOOK_URL` is set), and saves it onto that contact. **This spends Apollo credits.** Run `apollo-enrich` first.

| Field | Type | Required |
|---|---|---|
| `website` | string | yes |
| `apollo_id` | string (from the enriched contact) | yes |
| `reveal_phone` | boolean | no |

```bash
curl -X POST http://localhost:5050/api/companies/apollo-reveal-contact \
  -H 'Content-Type: application/json' -d '{"website":"https://www.example.com","apollo_id":"<id>"}'
```

- `200 { "success": true, "contact": {...}, "company": {...} }`
- `400 "website and apollo_id are required"`
- `404 "No contact found in Apollo for that apollo_id"` / `404 "Company/contact not found. Run apollo-enrich first."`

## Tests

The test scripts are manual and make live calls to the real sources. Run them from the project root. Pass arguments after `--`.

| Command | Exercises | Needs |
|---|---|---|
| `npm run test:website` | Website crawler/extractor (optimusbt.com) | Playwright Chromium |
| `npm run test:sec -- "Apple" [cik] [facts]` | SEC adapter | `SEC_USER_AGENT` |
| `npm run test:mca -- "Optimus BT" [websiteUrl]` | MCA adapter | `DATA_GOV_*` |
| `npm run test:companies-house -- "Tesco" [companyNumber]` | Companies House adapter | `COMPANIES_HOUSE_API_KEY` |
| `npm run test:opencorporates -- "Tesla" [jurisdiction] [officers]` | OpenCorporates adapter | `OPENCORPORATES_API_KEY` |
| `npm run test:leadership -- "Tesla" "https://www.tesla.com" US` | Full leadership pipeline, in-process | `OPENAI_API_KEY` + source keys |
| `npm run test:leadership-endpoint -- "Tesla" "tesla.com" US` | `POST /api/leadership-research` over HTTP | **A running server** |
| `npm run test:unified -- "https://www.tesla.com"` | `POST /api/research` over HTTP | **A running server** |

When a credential is missing, the adapter scripts print the adapter's error or `NOT_CONFIGURED` result instead of crashing. Run the endpoint scripts with no arguments to check the `400` validation path.

## Project structure

```text
src/
├── server.js     App entrypoint: load env, connect DB, JSON middleware, register routes, listen
├── config/       env.js (dotenv) and db.js (MongoDB connection)
├── models/       Mongoose schemas: Company, LeadershipReport
├── agents/       LLM agent definitions: companyResearchAgent, leadershipDiscoveryAgent
├── adapters/     One folder per external source: fetch/client, finder, mapper, store, agent tool
│   ├── website/  companiesHouse/  sec/  mca/  opencorporates/
│   └── wikidata/ brave/  apollo/
├── validation/   Deterministic decision logic (no LLM)
│   ├── companyProfile/  fact resolution, confidence scoring, profile building
│   └── leadership/      entity resolution, evidence validation, role taxonomy, scoring, report building
├── services/     Cross-source orchestration: leadershipResearch, unifiedResearch,
│                 companyApolloEnrichment, leadershipStore (report persistence)
└── routes/       Express routers, one per endpoint group (mounted by routes/index.js)
tests/
├── adapters/     One manual script per adapter
├── pipelines/    In-process pipeline scripts
├── endpoints/    HTTP scripts (require a running server)
└── validation/   Reserved for validation-logic scripts
data/             Raw/cached JSON per source (git-ignored)
specs/            Feature specs, plans, and contracts (spec-kit)
.specify/         Spec-kit scaffolding and the project constitution
```

To add a new data source, create `src/adapters/<source>/` with its own fetch, map, and store pieces plus a `tests/adapters/test<Source>.js` script (constitution principles VI and VII). Wire it in from a service. Accept/reject decisions go in `src/validation/`, never in an agent (principle III).
# hiptraw-research-agent
