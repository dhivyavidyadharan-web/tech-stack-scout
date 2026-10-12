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

export interface InfraTool {
  name: string;
  category: InfraCategory;
  /** Human-readable proof, e.g. "cli: Dockerfile" */
  evidence: string[];
  /** true = found in real files/manifests; false = only mentioned in names/topics. */
  confirmed: boolean;
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
  provider: "greenhouse" | "lever" | "ashby";
  boardUrl: string;
  totalRoles: number;
  engineeringRoles: number;
  sampleTitles: string[];
  /** Tools/languages mentioned across engineering job descriptions, by number of postings. */
  tools: { name: string; count: number }[];
  /** Postings that mention microservices / distributed systems. */
  microservicesMentions: number;
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
  raw_stats: RawStats | Record<string, never>;
  ai_model: string | null;
  refresh_error: string | null;
  hiring_signals: HiringSignals | null;
  architecture: Architecture | Record<string, never>;
  blog_posts: BlogPost[];
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
    | "INTERNAL";
  resetAt?: string;
}
