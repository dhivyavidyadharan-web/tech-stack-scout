-- Fixed-window rate limiting for public write/enrich endpoints (shared across serverless instances).
create table if not exists public.api_rate_events (
  id         bigserial primary key,
  bucket     text not null,              -- e.g. 'enrich:203.0.113.7' or 'enrich:*' (global)
  created_at timestamptz not null default now()
);
create index if not exists idx_rate_bucket_time on public.api_rate_events (bucket, created_at desc);
alter table public.api_rate_events enable row level security;  -- service-role only
