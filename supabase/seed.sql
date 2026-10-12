-- Seed watchlist: 5 developer-tooling companies with active public GitHub orgs.
-- Intelligence rows are produced live by POST /api/enrich/:id (or "Refresh all" in the UI).
insert into public.companies (name, domain, github_org) values
  ('Supabase',   'supabase.com',   'supabase'),
  ('Vercel',     'vercel.com',     'vercel'),
  ('Postman',    'postman.com',    'postmanlabs'),
  ('HashiCorp',  'hashicorp.com',  'hashicorp'),
  ('Prisma',     'prisma.io',      'prisma')
on conflict (github_org) do nothing;
