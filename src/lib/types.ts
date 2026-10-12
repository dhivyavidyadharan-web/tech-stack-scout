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
  /** Human-readable proof, e.g. "supabase/cli: Dockerfile" */
  evidence: string[];
}

export interface FitReason {
  label: string;
  points: number;
  max: number;
}

export type PitchTone = "technical" | "executive" | "casual";
export type PitchVariants = Partial<Record<PitchTone, string>>;

export interface TopRepo {
  name: string;
  url: string;
  language: string | null;
  stars: number;
  pushed_at: string;
  description: string | null;
}

/** Aggregate GitHub facts — the only input the LLM sees. */
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
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  github_org: string;
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
  raw_stats: RawStats | Record<string, never>;
  ai_model: string | null;
  refresh_error: string | null;
}

export interface Snapshot {
  id: string;
  company_id: string;
  captured_at: string;
  velocity_score: VelocityScore | null;
  fit_score: number | null;
  commits_30d: number | null;
  active_repo_count: number | null;
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
