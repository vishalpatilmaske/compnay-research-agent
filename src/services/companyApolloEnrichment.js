import Company from "../models/Company.js";
import { findApolloOrganization, findApolloPeople, revealApolloPerson } from "./apollo.js";

// Deterministically enriches a stored company with Apollo firmographics and
// fully-revealed contacts, and persists the result. This does NOT depend on
// an LLM deciding to call the right tools - it always fetches the
// organization, finds contacts, and reveals every new one, merging onto
// whatever the company document already has so nothing is duplicated or lost.
export async function enrichCompanyWithApollo({ website, domain, titles = [], limit = 10 }) {
  const [organization, foundContacts] = await Promise.all([
    findApolloOrganization({ domain }),
    findApolloPeople({ domain, titles, limit }),
  ]);

  const existing = await Company.findOne({ website });

  // Drop any contact without an apollo_id: contacts are exclusively
  // Apollo-managed, so one lacking an apollo_id can only be stale junk from
  // before this field existed, and can't be deduped reliably anyway.
  const existingContacts = (existing?.contacts || []).filter((c) => c.apollo_id);
  const existingIds = new Set(existingContacts.map((c) => c.apollo_id));

  // Reveal full details for every newly found contact (spends one Apollo
  // credit per new contact). Contacts already stored are left untouched so
  // re-running this never re-spends credits on the same person.
  const newContacts = foundContacts.filter((c) => c.apollo_id && !existingIds.has(c.apollo_id));

  const revealed = await Promise.all(
    newContacts.map((c) =>
      revealApolloPerson({ apolloId: c.apollo_id, revealPhone: true }).catch(() => null),
    ),
  );

  const contacts = [...existingContacts, ...newContacts.map((masked, i) => revealed[i] || masked)];

  const update = { website, domain, contacts };

  if (organization) {
    update.apollo_organization_id = organization.apollo_id;
    if (organization.name) update.name = organization.name;
    if (organization.industry) update.industry = organization.industry;
    if (organization.employee_count != null) {
      update.employee_count = organization.employee_count;
    }
    if (organization.founded_year) update.founded_year = organization.founded_year;
    if (organization.headquarters) {
      update["location.headquarters"] = organization.headquarters;
    }
    if (organization.annual_revenue != null) {
      update.annual_revenue = organization.annual_revenue;
    }
    if (organization.phone) update.phone = organization.phone;

    // Merge new social links without duplicating a platform already stored.
    const socialCandidates = [
      organization.linkedin_url && { platform: "linkedin", url: organization.linkedin_url },
      organization.twitter_url && { platform: "twitter", url: organization.twitter_url },
      organization.facebook_url && { platform: "facebook", url: organization.facebook_url },
    ].filter(Boolean);

    if (socialCandidates.length > 0) {
      const socials = [...(existing?.social_profiles || [])];
      for (const social of socialCandidates) {
        if (!socials.some((s) => s.platform.toLowerCase() === social.platform)) {
          socials.push(social);
        }
      }
      update.social_profiles = socials;
    }

    // Merge new technology names without duplicating existing entries.
    const existingTechNames = new Set(
      (existing?.technologies || []).map((t) => (t.name || "").toLowerCase()),
    );
    const newTechnologyNames = [...new Set(organization.technologies || [])].filter(
      (name) => name && !existingTechNames.has(name.toLowerCase()),
    );

    if (newTechnologyNames.length > 0) {
      update.technologies = [
        ...(existing?.technologies || []),
        ...newTechnologyNames.map((name) => ({
          name,
          category: null,
          source_url: organization.website_url || null,
        })),
      ];
    }
  }

  const company = await Company.findOneAndUpdate({ website }, update, {
    new: true,
    upsert: true,
    runValidators: true,
  });

  return { organization, company };
}
