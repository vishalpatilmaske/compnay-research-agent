// Deterministic title -> canonical role normalization. Order matters: the
// first matching pattern wins, so more specific titles (e.g. "Executive
// Vice President") must be listed before the generic ones they'd otherwise
// also match (e.g. "Vice President").
//
// Director/Board Member are intentionally never mapped to anything more
// senior — "Director != CEO, Director != Founder" per spec. Founder/
// Co-Founder are likewise never inferred from any other role; they only
// appear here because a raw title literally said "Founder"/"Co-Founder".
const ROLE_RULES = [
  { role: "CEO", pattern: /chief executive officer|\bceo\b/i },
  { role: "CTO", pattern: /chief technology officer|\bcto\b/i },
  { role: "CFO", pattern: /chief financial officer|\bcfo\b/i },
  { role: "COO", pattern: /chief operating officer|\bcoo\b/i },
  { role: "CMO", pattern: /chief marketing officer|\bcmo\b/i },
  { role: "CPO", pattern: /chief product officer|\bcpo\b/i },
  { role: "CRO", pattern: /chief revenue officer|\bcro\b/i },
  { role: "CIO", pattern: /chief information officer|\bcio\b/i },
  { role: "CISO", pattern: /chief information security officer|\bciso\b/i },
  { role: "Managing Director", pattern: /managing director/i },
  { role: "President", pattern: /\bpresident\b/i },
  { role: "Chair", pattern: /chairman|chairwoman|chairperson|\bchair\b/i },
  { role: "EVP", pattern: /executive vice president|\bevp\b/i },
  { role: "SVP", pattern: /senior vice president|\bsvp\b/i },
  { role: "VP", pattern: /vice president|\bvp\b/i },
  { role: "Head of Engineering", pattern: /head of engineering/i },
  { role: "Head of Product", pattern: /head of product/i },
  { role: "Head of Sales", pattern: /head of sales/i },
  { role: "Head of Marketing", pattern: /head of marketing/i },
  { role: "Co-Founder", pattern: /co-?founder/i },
  { role: "Founder", pattern: /\bfounder\b/i },
  {
    role: "Board Member",
    pattern: /board member|non-executive director|board director|member of the board/i,
  },
  { role: "Secretary", pattern: /\bsecretary\b/i },
  { role: "Director", pattern: /\bdirector\b/i },
];

// Seniority order used only to pick the single "primary" role when a person
// has multiple independently-evidenced roles (see all_roles in schema.js).
// Does not imply any role can be inferred from another.
const SENIORITY_ORDER = [
  "CEO",
  "President",
  "Chair",
  "Managing Director",
  "COO",
  "CFO",
  "CTO",
  "CMO",
  "CPO",
  "CRO",
  "CIO",
  "CISO",
  "Founder",
  "Co-Founder",
  "EVP",
  "SVP",
  "VP",
  "Head of Engineering",
  "Head of Product",
  "Head of Sales",
  "Head of Marketing",
  "Board Member",
  "Director",
  "Secretary",
  "Other",
];

// Roles a company realistically has only one *current* holder of — used by
// evidenceValidator.js to decide when a later, differently-named claim
// supersedes an earlier one. Founder/Co-Founder/Director/Board Member/
// Head of * are deliberately excluded: multiple people can legitimately
// hold those simultaneously, so "a different name showed up later" is not
// evidence of succession for them.
export const SINGULAR_ROLES = new Set([
  "CEO",
  "CFO",
  "COO",
  "CMO",
  "CPO",
  "CRO",
  "CIO",
  "CISO",
  "President",
  "Chair",
  "Managing Director",
]);

const PERSON_TYPE_BY_ROLE = {
  Founder: "founder",
  "Co-Founder": "founder",
  Director: "director",
  Secretary: "director",
  "Board Member": "board_member",
};

// Compound titles ("Founder & CEO", "Co-Founder and CTO") are common on team
// pages and each half is independently a real, evidenced role — so this
// returns every canonical role the raw title matches, not just the first.
// Order in ROLE_RULES still matters for disambiguating overlapping patterns
// (e.g. EVP checked before the plain VP pattern it would also match), but
// no longer stops the scan once one rule matches.
export function normalizeRoles(rawTitle) {
  const title = (rawTitle || "").trim();
  if (!title) return ["Other"];

  const matched = [];
  for (const rule of ROLE_RULES) {
    if (rule.pattern.test(title) && !matched.includes(rule.role)) {
      matched.push(rule.role);
    }
  }
  return matched.length ? matched : ["Other"];
}

// Single-role convenience wrapper — the first (highest-priority) canonical
// role a title matches. Prefer normalizeRoles() for anything that should
// respect a compound title's multiple roles.
export function normalizeRole(rawTitle) {
  return normalizeRoles(rawTitle)[0];
}

export function personTypeForRole(role) {
  return PERSON_TYPE_BY_ROLE[role] || (role === "Other" ? "other" : "executive");
}

// Picks the most senior role from a set of independently-evidenced roles
// for one person, to serve as the single primary `role` field.
export function primaryRole(roles) {
  if (!roles || roles.length === 0) return "Other";

  let best = roles[0];
  let bestIndex = SENIORITY_ORDER.indexOf(best);
  if (bestIndex === -1) bestIndex = SENIORITY_ORDER.length;

  for (const role of roles.slice(1)) {
    let index = SENIORITY_ORDER.indexOf(role);
    if (index === -1) index = SENIORITY_ORDER.length;
    if (index < bestIndex) {
      best = role;
      bestIndex = index;
    }
  }
  return best;
}
