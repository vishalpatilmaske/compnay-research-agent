import axios from "axios";

const API_URL = "https://www.wikidata.org/w/api.php";
const REQUEST_TIMEOUT = 15000;

// Free, public, no API key. Wikidata's own fair-use guidance asks for a
// descriptive User-Agent identifying the application, same spirit as SEC's
// requirement (sec.client.js) even though it's not strictly enforced.
const USER_AGENT = "CompanyResearchAgent/1.0 (leadership-research)";

// Leadership-relevant properties only — enrichment, not exhaustive company
// data. P169 chief executive officer, P112 founded by, P488 chairperson,
// P3320 board member, P169 already covers CEO; P1037 director/manager.
const LEADERSHIP_PROPERTIES = {
  P169: "Chief Executive Officer",
  P112: "Founder",
  P488: "Chairperson",
  P3320: "Board Member",
  P1037: "Director/Manager",
};

async function apiGet(params) {
  const response = await axios.get(API_URL, {
    params: { format: "json", origin: "*", ...params },
    headers: { "User-Agent": USER_AGENT },
    timeout: REQUEST_TIMEOUT,
  });
  return response.data;
}

// wbsearchentities — free-text search for a Wikidata item. Used only to
// find the company's own QID; not itself a source of leadership evidence.
export async function searchEntity(name) {
  const data = await apiGet({
    action: "wbsearchentities",
    search: name,
    language: "en",
    type: "item",
    limit: 5,
  });
  return data.search || [];
}

function labelFor(entities, qid, lang = "en") {
  return entities?.[qid]?.labels?.[lang]?.value || null;
}

// Pulls qualifier start/end times (P580 start time, P582 end time) off a
// claim, when present, as ISO-ish date strings — this is what lets a
// Wikidata leadership claim carry a real effective_from/effective_to
// instead of always being null.
function qualifierTime(claim, property) {
  const snak = claim.qualifiers?.[property]?.[0];
  const time = snak?.datavalue?.value?.time;
  if (!time) return null;
  // Wikidata time values look like "+2015-01-01T00:00:00Z" — strip the
  // leading sign and keep just the date.
  const match = time.match(/^\+?(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// wbgetentities — fetches the item's claims for the leadership-relevant
// properties above, resolving each value QID to a human-readable label via
// the same batched request (Wikidata lets you request multiple entities in
// one call, so the value QIDs are folded into the same fetch rather than a
// second round-trip per person).
export async function getLeadershipClaims(qid) {
  const entityData = await apiGet({
    action: "wbgetentities",
    ids: qid,
    props: "claims|labels",
    languages: "en",
  });

  const entity = entityData.entities?.[qid];
  if (!entity) return { companyLabel: null, claims: [] };

  const companyLabel = entity.labels?.en?.value || null;
  const claims = entity.claims || {};

  const valueQids = new Set();
  for (const property of Object.keys(LEADERSHIP_PROPERTIES)) {
    for (const claim of claims[property] || []) {
      const qidValue = claim.mainsnak?.datavalue?.value?.id;
      if (qidValue) valueQids.add(qidValue);
    }
  }

  let valueLabels = {};
  if (valueQids.size > 0) {
    const valuesData = await apiGet({
      action: "wbgetentities",
      ids: [...valueQids].join("|"),
      props: "labels",
      languages: "en",
    });
    valueLabels = valuesData.entities || {};
  }

  const results = [];
  for (const [property, roleLabel] of Object.entries(LEADERSHIP_PROPERTIES)) {
    for (const claim of claims[property] || []) {
      const qidValue = claim.mainsnak?.datavalue?.value?.id;
      if (!qidValue) continue;

      const personName = labelFor(valueLabels, qidValue);
      if (!personName) continue;

      results.push({
        property,
        role: roleLabel,
        name: personName,
        startTime: qualifierTime(claim, "P580"),
        endTime: qualifierTime(claim, "P582"),
      });
    }
  }

  return { companyLabel, claims: results };
}

// Convenience: search for the company, take the top hit, and return its
// leadership claims — null if nothing is found (never guesses a QID).
export async function findCompanyLeadershipClaims(companyName) {
  const hits = await searchEntity(companyName);
  const top = hits[0];
  if (!top) return null;

  const { companyLabel, claims } = await getLeadershipClaims(top.id);
  return { qid: top.id, url: `https://www.wikidata.org/wiki/${top.id}`, companyLabel, claims };
}
