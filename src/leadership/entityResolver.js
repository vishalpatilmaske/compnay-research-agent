// Deterministic same-person merging. Two tiers, deliberately kept distinct:
//
//   confident match  -> auto-merge (same last name + identical first-name
//                        token, e.g. "John Smith" / "John A. Smith" /
//                        "John Smith, CEO" once titles are stripped upstream)
//   ambiguous match   -> never auto-merge; kept as separate clusters and
//                        cross-referenced via possible_duplicate_of instead
//                        (same last name, but one first name is a bare
//                        initial compatible with the other's, e.g.
//                        "J. Smith" / "John Smith" — genuinely could be the
//                        same person or could be "Jane Smith")
//   no relation       -> nothing. Critically, two *fully spelled-out*,
//                        different first names sharing a last name (e.g.
//                        "Elon Musk" / "Kimbal Musk") are NOT ambiguous —
//                        they're just two different people who share a
//                        common surname, which is normal and not by itself
//                        evidence of anything. Confirmed against a live
//                        Tesla run where both appear on the board: an
//                        earlier version of this file flagged them as
//                        possible duplicates purely for sharing "Musk",
//                        which was wrong.

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/[^a-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Post-nominal honorifics some sources include and others omit (e.g. board
// bios: "Eileen Burbidge, MBE" vs a press mention of plain "Eileen
// Burbidge") — confirmed live on a Monzo run, where this was the one thing
// stopping an otherwise-exact name match. Stripped as trailing tokens only,
// never from the middle of a name, so a real surname can never be mistaken
// for one of these.
const HONORIFIC_SUFFIXES = new Set([
  "mbe", "obe", "cbe", "kbe", "dbe", "gbe",
  "jr", "sr", "ii", "iii", "iv",
  "phd", "md", "esq",
]);

function tokenize(name) {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  while (tokens.length > 1 && HONORIFIC_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens;
}

function lastNamesMatch(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  return tokensA[tokensA.length - 1] === tokensB[tokensB.length - 1];
}

// Same last name and an exact first-name token match. Middle
// names/initials are ignored on either side — their presence or absence
// doesn't block a confident match, only the first and last tokens matter.
function isConfidentMatch(tokensA, tokensB) {
  if (!lastNamesMatch(tokensA, tokensB)) return false;
  return tokensA[0] === tokensB[0];
}

// Same last name, first names differ but aren't ruled out — one side is a
// single-letter initial matching the other's first letter. Never true when
// both first names are exact matches (that's a confident match, handled
// above) or when both are fully spelled out and genuinely different.
function isAmbiguousMatch(tokensA, tokensB) {
  if (!lastNamesMatch(tokensA, tokensB)) return false;

  const firstA = tokensA[0];
  const firstB = tokensB[0];
  if (firstA === firstB) return false;

  if (firstA.length === 1) return firstA[0] === firstB[0];
  if (firstB.length === 1) return firstB[0] === firstA[0];
  return false;
}

// Groups claims into per-person clusters using only confident matches, then
// separately flags ambiguous (but unmerged) cluster pairs. Returns
// { clusters: [{ canonicalName, claims }], ambiguousPairs: [[clusterIndexA, clusterIndexB]] }
export function resolveEntities(claims) {
  const clusters = [];

  for (const claim of claims) {
    const claimTokens = tokenize(claim.name);
    const match = clusters.find((cluster) => isConfidentMatch(tokenize(cluster.canonicalName), claimTokens));

    if (match) {
      match.claims.push(claim);
      const currentTokens = tokenize(match.canonicalName);
      if (
        claimTokens.length > currentTokens.length ||
        (claimTokens.length === currentTokens.length && claim.name.length > match.canonicalName.length)
      ) {
        match.canonicalName = claim.name;
      }
    } else {
      clusters.push({ canonicalName: claim.name, claims: [claim] });
    }
  }

  const ambiguousPairs = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (isAmbiguousMatch(tokenize(clusters[i].canonicalName), tokenize(clusters[j].canonicalName))) {
        ambiguousPairs.push([i, j]);
      }
    }
  }

  return { clusters, ambiguousPairs };
}
