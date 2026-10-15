-- Feedback loop: Nikhil rates openers and records whether outreach got a reply.
create table if not exists public.opener_feedback (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  opener      text not null,
  tone        text not null default 'primary',
  rating      smallint not null check (rating in (1, -1)),   -- 1 = thumbs up, -1 = thumbs down
  created_at  timestamptz not null default now()
);
create index if not exists idx_feedback_company_time on public.opener_feedback (company_id, created_at desc);
alter table public.opener_feedback enable row level security;  -- service-role only

alter table public.companies
  add column if not exists reply_status     text check (reply_status in ('replied', 'no_reply')),
  add column if not exists reply_updated_at timestamptz;

drop view if exists public.stale_companies;
create view public.stale_companies
with (security_invoker = true) as
select c.*, ei.last_refreshed_at
from public.companies c
left join public.engineering_intelligence ei on ei.company_id = c.id
where ei.last_refreshed_at is null
   or ei.last_refreshed_at < now() - interval '7 days';
