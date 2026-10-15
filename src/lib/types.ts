// Shared domain types used by route handlers, services and the dashboard.

export type VelocityScore = "High" | "Moderate" | "Low";

export type InfraCategory =
  | "Container"
  | "Orchestration"
  | "Cloud"
  | "IaC"
  | "CI/CD"
  | "Hosting"
  | "Monorepo"
  | "Observability";

export interface LanguageShare {
  name: string;
  bytes: number;
  percentage: number;
}

export interface EvidenceSource {
  label: string;
  url: string;
  /** file = found in the repo tree · manifest = package.json dependency · job = job posting · mention = name/description/topic only */
  kind: "file" | "manifest" | "job" | "mention";
}

export interface InfraTool {
  name: string;
  category: InfraCategory;
  /** Human-readable proof, e.g. "cli: Dockerfile" */
  evidence: string[];
  /** true = found in real files/manifests; false = only mentioned in names/topics. */
  confirmed: boolean;
  /** Clickable proof for each evidence item (newer refreshes only). */
  sources?: EvidenceSource[];
}

export interface FitReason {
  label: string;
  points: number;
  max: number;
}

export type PitchTone = "technical" | "executive" | "casual";
export type PitchVariants = Partial<Record<PitchTone, string>> & {
  /** Which concrete fact the primary hook is built on, e.g. "hiring". */
  angle?: string;
  /** buying-signal = evidence of dev-productivity need; context = interesting event, no pain asserted. */
  hookType?: "buying-signal" | "context";
  /** The exact observed fact the primary hook is built on. */
  hookEvidence?: string;
};

export interface TopRepo {
  name: string;
  url: string;
  language: string | null;
  stars: number;
  pushed_at: string;
  description: string | null;
}

export type MicroservicesVerdict = "Likely" | "Possible" | "Unlikely";

export interface Architecture {
  microservices: MicroservicesVerdict;
  /** Human-readable proof, e.g. "supabase: 9 Dockerfiles across separate services" */
  signals: string[];
}

export interface HiringSignals {
  provider: "greenhouse" | "lever" | "ashby" | "workable" | "recruitee" | "smartrecruiters";
  boardUrl: string;
  totalRoles: number;
  engineeringRoles: number;
  sampleTitles: string[];
  /** Tools/languages mentioned across engineering job descriptions, by number of postings. */
  tools: { name: string; count: number }[];
  /** Postings that mention microservices / distributed systems. */
  microservicesMentions: number;
  /** Engineering postings that name the most tools — the JDs worth reading before a call. */
  matchingJobs?: JobPosting[];
  /** Open roles that point at developer-productivity work (platform, devex, build, CI, release, SRE, tooling). */
  productivityRoles?: { title: string; url: string | null }[];
}

/** Evidence that more directly suggests developer-productivity need than raw complexity. */
export interface BuyingSignal {
  kind: "hiring" | "content" | "ci" | "monorepo" | "architecture";
  fact: string;
  url: string | null;
}

export interface JobPosting {
  title: string;
  url: string | null;
  /** Tools from JOB_KEYWORDS this posting mentions. */
  tools: string[];
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  published: string | null;
  kind: "news" | "hn";
  /** Hacker News points (kind = "hn"). */
  points?: number;
}

export interface Release {
  repo: string;
  tag: string;
  name: string;
  url: string;
  published: string;
}

export interface NewRepo {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  created: string;
}

export interface Building {
  releases: Release[];
  newRepos: NewRepo[];
}

export interface BlogPost {
  title: string;
  url: string;
  published: string | null;
}

/** Aggregate public facts (GitHub + jobs + blog) — the only input the LLM sees. */
export interface RawStats {
  org: string;
  orgName: string | null;
  orgDescription: string | null;
  publicRepos: number;
  reposAnalyzed: number;
  deepScannedRepos: string[];
  activeRepos30d: number;
  pushedLast7d: number;
  commits30d: number;
  workflowFileCount: number;
  totalStars: number;
  lastPushAt: string | null;
  lastCommitAt: string | null;
  languages: LanguageShare[];
  infra: InfraTool[];
  topRepos: TopRepo[];
  topics: string[];
  architecture: Architecture;
  hiring: HiringSignals | null;
  blogPosts: BlogPost[];
  news: NewsItem[];
  building: Building;
  buyingSignals: BuyingSignal[];
}

export interface WhyItMatters {
  /** What we observed (must be in the data). */
  signal: string;
  /** Why that makes the seller's product relevant. */
  relevance: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  github_org: string;
  created_at: string;
  /** Optional override / cached discovery, e.g. "greenhouse:vercel" or "none". */
  jobs_board: string | null;
  /** Optional override / cached discovery: RSS/Atom URL or "none". */
  blog_feed_url: string | null;
  /** Optional Google News query override for ambiguous names, or "none". */
  news_query: string | null;
  /** Feedback loop: did the outreach get a reply? (set by Nikhil after sending) */
  reply_status: "replied" | "no_reply" | null;
  reply_updated_at: string | null;
}

/** One 👍/👎 Nikhil gave an opener. */
export interface OpenerFeedback {
  id: string;
  company_id: string;
  opener: string;
  tone: string;
  rating: 1 | -1;
  created_at: string;
}

export interface EngineeringIntelligence {
  id: string;
  company_id: string;
  dominant_languages: LanguageShare[];
  cloud_infra_tools: InfraTool[];
  velocity_score: VelocityScore | null;
  active_repo_count: number;
  last_commit_date: string | null;
  engineering_summary: string | null;
  outreach_pitch: string | null;
  last_refreshed_at: string | null;
  fit_score: number | null;
  fit_reasons: FitReason[];
  pitch_variants: PitchVariants;
  commits_30d: number | null;
  total_stars: number | null;
  top_repos: TopRepo[];
  /** Full aggregate in the DB; trimmed to the fields the UI needs when sent to the browser. */
  raw_stats: Partial<RawStats>;
  ai_model: string | null;
  refresh_error: string | null;
  hiring_signals: HiringSignals | null;
  architecture: Architecture | Record<string, never>;
  blog_posts: BlogPost[];
  overview: string | null;
  why_it_matters: WhyItMatters[];
  buying_signals: BuyingSignal[];
  /** What public data cannot tell us (private repos, actual CI durations, …). */
  unknowns: string[];
  news: NewsItem[];
  building: Building | Record<string, never>;
}

export interface Snapshot {
  id: string;
  company_id: string;
  captured_at: string;
  velocity_score: VelocityScore | null;
  fit_score: number | null;
  commits_30d: number | null;
  active_repo_count: number | null;
  open_eng_roles: number | null;
  dominant_languages: LanguageShare[];
  cloud_infra_tools: InfraTool[];
}

export interface CompanyWithIntel extends Company {
  intelligence: EngineeringIntelligence | null;
  snapshots: Snapshot[];
  /** Most recent opener ratings, newest first. */
  feedback: OpenerFeedback[];
}

/** Uniform error envelope returned by every API route. */
export interface ApiError {
  error: string;
  code:
    | "GITHUB_NOT_FOUND"
    | "GITHUB_RATE_LIMIT"
    | "GITHUB_ERROR"
    | "VALIDATION"
    | "DUPLICATE"
    | "NOT_FOUND"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "RATE_LIMITED"
    | "LIMIT_REACHED"
    | "INTERNAL";
  resetAt?: string;
}
