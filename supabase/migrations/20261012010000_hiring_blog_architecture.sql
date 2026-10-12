-- =============================================================================
-- Tech Stack Scout — extra live sources: job postings, engineering blog, architecture
-- =============================================================================

-- Optional per-company source overrides (editable in the Supabase table editor;
-- auto-discovered values are cached here). Use 'none' to disable a source.
alter table public.companies
  add column if not exists jobs_board    text,   -- 'greenhouse:vercel' | 'ashby:supabase' | 'lever:acme' | 'none'
  add column if not exists blog_feed_url text;   -- RSS/Atom URL, or 'none'

alter table public.engineering_intelligence
  add column if not exists hiring_signals jsonb,                              -- {provider, boardUrl, engineeringRoles, totalRoles, sampleTitles[], tools[{name,count}]}
  add column if not exists architecture   jsonb not null default '{}'::jsonb, -- {microservices: Likely|Possible|Unlikely, signals[]}
  add column if not exists blog_posts     jsonb not null default '[]'::jsonb; -- [{title, url, published}]

alter table public.intelligence_snapshots
  add column if not exists open_eng_roles int;

drop view if exists public.stale_companies;
create view public.stale_companies
with (security_invoker = true) as
select c.*, ei.last_refreshed_at
from public.companies c
left join public.engineering_intelligence ei on ei.company_id = c.id
where ei.last_refreshed_at is null
   or ei.last_refreshed_at < now() - interval '7 days';
