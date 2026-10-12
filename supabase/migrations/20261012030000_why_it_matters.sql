-- "Why it matters": observed signal → relevance to the seller's product (Gemini Flash).
alter table public.engineering_intelligence
  add column if not exists why_it_matters jsonb not null default '[]'::jsonb; -- [{signal, relevance}]
