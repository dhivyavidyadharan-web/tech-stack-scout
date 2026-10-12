-- =============================================================================
-- Tech Stack Scout — schema
-- Run in Supabase SQL editor, or `supabase db push`.
-- =============================================================================
create extension if not exists "pgcrypto";

-- 1. Watchlist ----------------------------------------------------------------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  domain      text,
  github_org  text not null unique,
  created_at  timestamptz not null default now(),
  constraint github_org_lowercase check (github_org = lower(github_org))
);

-- 2. Latest intelligence (one row per company, upserted on every refresh) -----
create table if not exists public.engineering_intelligence (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null unique references public.companies(id) on delete cascade,
  dominant_languages  jsonb not null default '[]'::jsonb,   -- [{name, bytes, percentage}]
  cloud_infra_tools   jsonb not null default '[]'::jsonb,   -- [{name, category, evidence[], confirmed}]
  velocity_score      text check (velocity_score in ('High','Moderate','Low')),
  active_repo_count   int not null default 0,
  last_commit_date    timestamptz,
  engineering_summary text,                                 -- exactly 2 paragraphs, separated by a blank line
  outreach_pitch      text,                                 -- tailored 1-line cold hook
  last_refreshed_at   timestamptz,
  -- beyond-spec enrichment -----------------------------------------------------
  fit_score           int check (fit_score between 0 and 100),
  fit_reasons         jsonb not null default '[]'::jsonb,   -- [{label, points, max}]
  pitch_variants      jsonb not null default '{}'::jsonb,   -- {technical, executive, casual}
  commits_30d         int,
  total_stars         int,
  top_repos           jsonb not null default '[]'::jsonb,
  raw_stats           jsonb not null default '{}'::jsonb,   -- GitHub aggregate fed to the LLM (re-prompt without GitHub calls)
  ai_model            text,                                 -- gemini-flash-latest | heuristic-fallback
  refresh_error       text
);

-- 3. History of every enrichment run (powers the "what changed" timeline) -----
create table if not exists public.intelligence_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  captured_at        timestamptz not null default now(),
  velocity_score     text,
  fit_score          int,
  commits_30d        int,
  active_repo_count  int,
  dominant_languages jsonb not null default '[]'::jsonb,
  cloud_infra_tools  jsonb not null default '[]'::jsonb
);

create index if not exists idx_intel_last_refreshed on public.engineering_intelligence (last_refreshed_at nulls first);
create index if not exists idx_snapshots_company_time on public.intelligence_snapshots (company_id, captured_at desc);

-- Security: Postgres is only reached from server route handlers with the
-- service-role key. RLS is enabled with NO anon/authenticated policies, so the
-- public anon key can neither read nor write these tables.
alter table public.companies                enable row level security;
alter table public.engineering_intelligence enable row level security;
alter table public.intelligence_snapshots   enable row level security;

-- Companies due for a refresh (used by the weekly Vercel cron).
create or replace view public.stale_companies
with (security_invoker = true) as
select c.*, ei.last_refreshed_at
from public.companies c
left join public.engineering_intelligence ei on ei.company_id = c.id
where ei.last_refreshed_at is null
   or ei.last_refreshed_at < now() - interval '7 days';
