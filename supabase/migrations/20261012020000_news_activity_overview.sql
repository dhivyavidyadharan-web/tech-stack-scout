-- =============================================================================
-- Tech Stack Scout — "what are they building now": news, HN, releases, new repos
-- =============================================================================
alter table public.companies
  add column if not exists news_query text;     -- optional Google News query override for ambiguous names, or 'none'

alter table public.engineering_intelligence
  add column if not exists overview text,                                 -- 1–2 sentence TL;DR shown on the card
  add column if not exists news     jsonb not null default '[]'::jsonb,   -- [{title, url, source, published, kind: news|hn, points?}]
  add column if not exists building jsonb not null default '{}'::jsonb;   -- {releases[], newRepos[]}

drop view if exists public.stale_companies;
create view public.stale_companies
with (security_invoker = true) as
select c.*, ei.last_refreshed_at
from public.companies c
left join public.engineering_intelligence ei on ei.company_id = c.id
where ei.last_refreshed_at is null
   or ei.last_refreshed_at < now() - interval '7 days';
