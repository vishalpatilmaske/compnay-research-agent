import { normalizeRoles, primaryRole, SINGULAR_ROLES } from "./roleTaxonomy.js";

// Date fields are trusted in this priority order — an explicit effective
// date beats a generic publication date, which beats retrieved_at (when we
// merely fetched the page, not when the fact became true — the weakest
// possible signal, used only when nothing else is available).
function bestDateMs(evidence) {
  const raw = evidence.effective_from || evidence.effective_to || evidence.published_at || evidence.retrieved_at;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function clusterBestDateMs(claims) {
  const dates = claims.map(bestDateMs).filter((ms) => ms !== null);
  return dates.length ? Math.max(...dates) : null;
}

// Whether a role-holder's evidence shows they've since left that specific
// role (an explicit effective_to/resignation-style date on a claim for it).
function hasExplicitDeparture(claims) {
  return claims.some((c) => Boolean(c.effective_to));
}

// Takes entity-resolved clusters (see entityResolver.js) and, per cluster,
// works out: which canonical roles it has independent evidence for, the
// primary role, person_type, and current_status — then runs the one
// cross-cluster check this system performs: when two *different* people
// both have evidence for the same singular role (CEO, CFO, ... — see
// SINGULAR_ROLES), only the one with the latest resolvable date is
// "current"; the rest are "former". If dates can't be resolved or are
// effectively tied, every claimant for that role is marked "uncertain"
// rather than guessed — this is the one explicit rule the spec asks for
// ("2022: John Smith -> CEO, 2025: Mike Smith -> CEO ... determine from the
// latest valid evidence; if it can't be established confidently, return
// status: uncertain").
export function validateAndResolveRoles(clusters) {
  const people = clusters.map((cluster) => {
    // A compound raw title ("Founder & CEO") evidences every role it
    // contains, so the same claim is added to each of that title's role
    // buckets — not forced into a single one.
    const rolesWithClaims = new Map();
    for (const claim of cluster.claims) {
      for (const role of normalizeRoles(claim.raw_title)) {
        if (!rolesWithClaims.has(role)) rolesWithClaims.set(role, []);
        rolesWithClaims.get(role).push(claim);
      }
    }

    const allRoles = [...rolesWithClaims.keys()];
    const role = primaryRole(allRoles);
    const primaryRoleClaims = rolesWithClaims.get(role) || cluster.claims;

    return {
      canonicalName: cluster.canonicalName,
      claims: cluster.claims,
      allRoles,
      role,
      primaryRoleClaims,
      bestDateMs: clusterBestDateMs(primaryRoleClaims),
      // Filled in below for singular roles only; non-singular roles default
      // to "current" unless their own evidence explicitly shows departure.
      currentStatus: SINGULAR_ROLES.has(role)
        ? null
        : hasExplicitDeparture(primaryRoleClaims)
          ? "former"
          : "current",
      hasConflict: false,
    };
  });

  let conflictsFound = 0;

  const singularGroups = new Map();
  people.forEach((person, index) => {
    if (!SINGULAR_ROLES.has(person.role)) return;
    if (!singularGroups.has(person.role)) singularGroups.set(person.role, []);
    singularGroups.get(person.role).push(index);
  });

  for (const [, indices] of singularGroups) {
    if (indices.length === 1) {
      // A sole claimant for a singular role still isn't automatically
      // "current" — their own evidence can show they've since left it (e.g.
      // a proxy statement bio stating "served as CTO from 2005 to 2019").
      // Confirmed against a live Tesla run: without this check, a lone,
      // clearly-former CTO claim was marked "current" just for having no
      // competing claimant.
      const person = people[indices[0]];
      person.currentStatus = hasExplicitDeparture(person.primaryRoleClaims) ? "former" : "current";
      continue;
    }

    const withDates = indices.filter((i) => people[i].bestDateMs !== null);
    const sorted = [...withDates].sort((a, b) => people[b].bestDateMs - people[a].bestDateMs);

    const resolvable =
      sorted.length === indices.length && // every claimant has a resolvable date
      (sorted.length < 2 || people[sorted[0]].bestDateMs !== people[sorted[1]].bestDateMs); // not tied for latest

    if (resolvable && hasExplicitDeparture(people[sorted[0]].primaryRoleClaims)) {
      // Even the most-recent claimant's own evidence shows they've since
      // left the role — we have no evidence of a successor, so nobody in
      // this group can be confidently "current" rather than guessed.
      conflictsFound += 1;
      for (const i of indices) {
        people[i].currentStatus = "uncertain";
        people[i].hasConflict = true;
      }
    } else if (resolvable) {
      people[sorted[0]].currentStatus = "current";
      for (const i of sorted.slice(1)) {
        people[i].currentStatus = "former";
      }
    } else {
      conflictsFound += 1;
      for (const i of indices) {
        people[i].currentStatus = "uncertain";
        people[i].hasConflict = true;
      }
    }
  }

  // Every claim must already carry retrieved_at by this point (reportBuilder
  // attaches it before clustering), so bestDateMs can read fields directly
  // off each claim without any indirection.
  const latestMs = Math.max(
    -Infinity,
    ...clusters.flatMap((c) => c.claims.map(bestDateMs).filter((ms) => ms !== null)),
  );

  return {
    people,
    conflictsFound,
    latestEvidenceDate: Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : null,
  };
}
