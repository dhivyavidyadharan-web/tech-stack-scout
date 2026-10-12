-- Separate buying signals (evidence of need) from complexity, and record what public data can't tell us.
alter table public.engineering_intelligence
  add column if not exists buying_signals jsonb not null default '[]'::jsonb, -- [{kind, fact, url}]
  add column if not exists unknowns       jsonb not null default '[]'::jsonb; -- ["Actual CI durations are not public", …]
