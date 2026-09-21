import mongoose from "mongoose";

const SourceSchema = new mongoose.Schema(
  {
    title: { type: String, default: null },
    url: { type: String, default: null },
    source_type: { type: String, default: null },
    published_at: { type: String, default: null },
    accessed_at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const LocationSchema = new mongoose.Schema(
  {
    headquarters: { type: String, default: null },
    other_locations: {
      type: [String],
      default: [],
    },
  },
  { _id: false },
);

const PersonSchema = new mongoose.Schema(
  {
    name: { type: String, default: null },
    role: { type: String, default: null },
    title: { type: String, default: null },
    bio: { type: String, default: null },
    photo_url: { type: String, default: null },
    linkedin_url: { type: String, default: null },
    // Sourced from the company's own site (team/leadership/contact pages),
    // not Apollo — distinct from the Apollo-sourced `contacts` field below.
    email: { type: String, default: null },
    phone: { type: String, default: null },
    // Proof: the page this person's details were found on.
    source_url: { type: String, default: null },
  },
  { _id: false },
);

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, default: null },
    description: { type: String, default: null },
    source_url: { type: String, default: null },
  },
  { _id: false },
);

const FundingSchema = new mongoose.Schema(
  {
    round: { type: String, default: null },
    amount: { type: String, default: null },
    date: { type: String, default: null },
    investors: {
      type: [String],
      default: [],
    },
    source_url: { type: String, default: null },
  },
  { _id: false },
);

const NewsSchema = new mongoose.Schema(
  {
    title: { type: String, default: null },
    summary: { type: String, default: null },
    date: { type: String, default: null },
    url: { type: String, default: null },
  },
  { _id: false },
);

const TechnologySchema = new mongoose.Schema(
  {
    name: { type: String, default: null },
    category: { type: String, default: null },
    source_url: { type: String, default: null },
  },
  { _id: false },
);

const HiringSignalSchema = new mongoose.Schema(
  {
    signal: { type: String, default: null },
    description: { type: String, default: null },
    source_url: { type: String, default: null },
    date: { type: String, default: null },
  },
  { _id: false },
);

const ContactSchema = new mongoose.Schema(
  {
    apollo_id: { type: String, default: null },
    name: { type: String, default: null },
    title: { type: String, default: null },
    email: { type: String, default: null },
    email_status: { type: String, default: null },
    linkedin_url: { type: String, default: null },
    phone: { type: String, default: null },
    seniority: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    country: { type: String, default: null },
    source: { type: String, default: "apollo" },
  },
  { _id: false },
);

const CompanySchema = new mongoose.Schema(
  {
    // ==========================================
    // BASIC COMPANY INFORMATION
    // ==========================================

    name: {
      type: String,
      default: null,
      trim: true,
    },

    website: {
      type: String,
      required: true,
      trim: true,
    },

    domain: {
      type: String,
      default: null,
      trim: true,
    },

    description: {
      type: String,
      default: null,
    },

    industry: {
      type: String,
      default: null,
    },

    sub_industries: {
      type: [String],
      default: [],
    },

    founded_year: {
      type: Number,
      default: null,
    },

    company_size: {
      type: String,
      default: null,
    },

    employee_count: {
      type: Number,
      default: null,
    },

    // ==========================================
    // LOCATION
    // ==========================================

    location: {
      type: LocationSchema,
      default: () => ({
        headquarters: null,
        other_locations: [],
      }),
    },

    // ==========================================
    // PRODUCTS & SERVICES
    // ==========================================

    products: {
      type: [ProductSchema],
      default: [],
    },

    services: {
      type: [ProductSchema],
      default: [],
    },

    // ==========================================
    // CUSTOMERS / MARKET
    // ==========================================

    target_customers: {
      type: [String],
      default: [],
    },

    customer_types: {
      type: [String],
      default: [],
    },

    industries_served: {
      type: [String],
      default: [],
    },

    business_model: {
      type: String,
      default: null,
    },

    // ==========================================
    // PEOPLE
    // ==========================================

    founders: {
      type: [PersonSchema],
      default: [],
    },

    executives: {
      type: [PersonSchema],
      default: [],
    },

    key_people: {
      type: [PersonSchema],
      default: [],
    },

    // ==========================================
    // CONTACTS (Apollo)
    // ==========================================

    contacts: {
      type: [ContactSchema],
      default: [],
    },

    apollo_organization_id: {
      type: String,
      default: null,
    },

    annual_revenue: {
      type: Number,
      default: null,
    },

    phone: {
      type: String,
      default: null,
    },

    // ==========================================
    // FUNDING
    // ==========================================

    funding: {
      type: [FundingSchema],
      default: [],
    },

    total_funding: {
      type: String,
      default: null,
    },

    // ==========================================
    // COMPETITORS
    // ==========================================

    competitors: {
      type: [String],
      default: [],
    },

    // ==========================================
    // TECHNOLOGY
    // ==========================================

    technologies: {
      type: [TechnologySchema],
      default: [],
    },

    // ==========================================
    // HIRING
    // ==========================================

    hiring_signals: {
      type: [HiringSignalSchema],
      default: [],
    },

    // ==========================================
    // NEWS
    // ==========================================

    recent_news: {
      type: [NewsSchema],
      default: [],
    },

    // ==========================================
    // SOCIAL / PUBLIC PRESENCE
    // ==========================================

    social_profiles: {
      type: [
        {
          platform: {
            type: String,
            default: null,
          },
          url: {
            type: String,
            default: null,
          },
        },
      ],
      default: [],
    },

    // ==========================================
    // RESEARCH SOURCES
    // ==========================================

    sources: {
      type: [SourceSchema],
      default: [],
    },

    // ==========================================
    // RESEARCH METADATA
    // ==========================================

    research_status: {
      type: String,
      enum: ["pending", "researching", "completed", "failed"],
      default: "pending",
    },

    research_summary: {
      type: String,
      default: null,
    },

    research_errors: {
      type: [String],
      default: [],
    },

    last_researched_at: {
      type: Date,
      default: null,
    },
  },

  {
    timestamps: true,
    strict: false,
  },
);

// Useful index
CompanySchema.index({ website: 1 }, { unique: true });

export default mongoose.model("Company", CompanySchema);
