# Tech Stack Scout

A sales intelligence dashboard for enterprise Account Executives who sell developer productivity tools. For every target account it pulls **live GitHub data** and shows:

- **Dominant languages**, by share of code bytes (docs and prose excluded)
- **Cloud and infrastructure tooling**: Docker, Kubernetes, Terraform, AWS, GCP, GitHub Actions, Turborepo, and more. Each tag comes with file-level evidence and is marked *confirmed* or *mentioned*.
- **Build velocity** (High / Moderate / Low), based on commit and push recency
- **A two-paragraph engineering summary**, written by **Google Gemini Flash**
- **A tailored outreach opener**, plus technical, executive and casual versions you can regenerate and copy in one click
- **Microservices detection**: structural evidence (multiple Dockerfiles, deployable `services/` roots, Protobuf/gRPC contracts, Kubernetes manifests) plus job-post mentions
- **Hiring signals** from live public job boards (Greenhouse, Lever, Ashby): open engineering roles and the tools named in job descriptions
- **Recent engineering blog posts**, autodiscovered from each company's RSS or Atom feed
- **A fit score (0–100)** with a plain-language breakdown, a **change history** between refreshes, **CSV export** and a one-click **account brief**

Built with Next.js 16 (App Router, TypeScript, Tailwind v4, shadcn/ui), Supabase Postgres, the GitHub REST API, Gemini Flash and Vercel Cron.
See [COMPONENTS_MAP.md](COMPONENTS_MAP.md) for the architecture diagrams.

---

## Quick start (local)

```bash
cd tech-stack-scout
npm install
cp .env.example .env.local     # then fill in the values (see below)
npm run dev                    # http://localhost:3000
```

### 1. Database

Create a Supabase project, then run these two files in the **SQL Editor** in this order (or use `supabase db push`):

1. [`supabase/migrations/20261012000000_init_tech_stack_scout.sql`](supabase/migrations/20261012000000_init_tech_stack_scout.sql) creates the tables, indexes, RLS and the `stale_companies` view.
2. [`supabase/migrations/20261012010000_hiring_blog_architecture.sql`](supabase/migrations/20261012010000_hiring_blog_architecture.sql) adds the job-board, blog and architecture columns.
3. [`supabase/seed.sql`](supabase/seed.sql) adds five seed accounts: Supabase, Vercel, Postman, HashiCorp and Prisma.

The seed accounts start without intelligence. Click **"Enrich them now"** on the dashboard and they'll be scanned live.

### 2. Environment variables

| Variable | Required | Where to get it | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase → Project Settings → API | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase → Project Settings → API Keys → `service_role` (or a `sb_secret_…` key) | Server-side DB access. **Never expose it to the browser.** |
| `GEMINI_API_KEY` | ✅ (recommended) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Summaries and outreach hooks. Without it, a deterministic template is used. |
| `GITHUB_TOKEN` | ✅ (recommended) | [GitHub fine-grained token](https://github.com/settings/personal-access-tokens) with *Public repositories (read-only)* | Raises the GitHub limit from 60 to 5,000 requests/hr and enables deeper scans |
| `CRON_SECRET` | ✅ for cron | `openssl rand -hex 32` | Vercel Cron sends it as `Authorization: Bearer …` |
| `GEMINI_BASE_URL` | optional | from your key provider | Custom gateway/proxy URL for Gemini (e.g. institution-issued keys) |
| `GEMINI_USE_VERTEX` | optional | `true` / `false` | Use Vertex AI (express-mode key) instead of the Gemini Developer API |
| `GEMINI_MODEL` | optional | default `gemini-flash-latest` | Pin a specific Flash model, e.g. `gemini-2.5-flash` |
| `DASHBOARD_PASSWORD` | optional | any string | Enables HTTP Basic Auth on the whole app (any username) |
| `SELLER_PRODUCT_DESCRIPTION` | optional | free text | Describes what you sell; every opener is tailored to it |

### Managing the watchlist in Supabase (no code)

Nikhil can manage everything from the **Supabase Table Editor → `companies`**:

| Action | How |
|---|---|
| Add a company | Insert a row with `name` and `github_org` (lowercase). The daily cron enriches it within 24 hours, or click **Enrich now** on the dashboard. |
| Remove a company | Delete the row. Its intelligence and history are deleted with it. |
| Fix a job board | Set `jobs_board` to `greenhouse:<token>`, `lever:<token>` or `ashby:<token>`, or `none` to disable it. |
| Fix a blog feed | Set `blog_feed_url` to an RSS or Atom URL, or `none` to disable it. |

Discovered job boards and feeds are cached in those two columns. A source that stops responding is cleared and rediscovered on the next refresh.

> **Why server-only DB access?** The tables have RLS turned on with no public policies, so the anon key can't read or write anything. Every query goes through route handlers that use the service-role key.

### 3. Scripts

```bash
npm run dev      # dev server
npm run build    # production build (type-checks)
npm run lint     # ESLint
npx tsc --noEmit # type-check only
```

---

## Deploying to Vercel

1. Push the `tech-stack-scout` folder to a Git repo and import it at **vercel.com/new**. You can also deploy from the CLI with `npx vercel`. The framework preset is detected as Next.js.
2. In **Project → Settings → Environment Variables**, add every variable from the table above for Production (and Preview if you like).
3. Deploy. [`vercel.json`](vercel.json) registers two cron jobs:
   ```json
   { "crons": [
       { "path": "/api/cron/refresh",          "schedule": "0 0 * * 0" },
       { "path": "/api/cron/refresh?mode=new", "schedule": "0 6 * * *" }
   ] }
   ```
   - **Weekly (Sunday 00:00 UTC):** refreshes every company whose intelligence is more than 7 days old.
   - **Daily (06:00 UTC):** enriches only companies that have *never* been enriched. A row Nikhil adds straight in the Supabase table editor gets its brief within 24 hours, without anyone touching code.

   Vercel automatically sends `Authorization: Bearer $CRON_SECRET`.
4. Check the cron under **Project → Settings → Cron Jobs**, or trigger it by hand:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/cron/refresh
   ```
   The response lists each company as `refreshed`, `failed` or `skipped`.

The cron route sets `maxDuration = 300` and works within a 240s budget. It refreshes the stalest accounts first and stops early on a GitHub rate limit; the next run picks up the rest.

---

## API reference

| Method & path | Description |
|---|---|
| `GET /api/companies` | Watchlist with the latest intelligence and the last 12 snapshots per company |
| `POST /api/companies` | `{ github_org, name?, domain? }`. Checks the org exists on GitHub (`404` if not), rejects duplicates (`409`), saves it and enriches it right away. If the enrichment step fails, the company is still saved and a `warning` is returned. |
| `DELETE /api/companies/:id` | Removes a company. Its intelligence and history are deleted with it. |
| `POST /api/enrich/:companyId` | Runs the full pipeline: GitHub → infra detection → scoring → Gemini Flash → upsert and snapshot |
| `GET /api/cron/refresh` | Bearer-protected. Refreshes companies whose `last_refreshed_at` is older than 7 days or null. With `?mode=new`, only never-enriched companies are processed. |
| `POST /api/pitch/:companyId` | `{ tone: "technical" \| "executive" \| "casual", makePrimary? }`. Regenerates one hook from cached stats (Gemini only, no GitHub calls). |
| `GET /api/export` | The watchlist as CSV, ready for a CRM import |
| `GET /api/health` | Shows whether each integration is configured (never the secret values) and how much GitHub quota is left |

Errors always come back as `{ error, code, resetAt? }`. `code` is one of `GITHUB_NOT_FOUND`, `GITHUB_RATE_LIMIT`, `VALIDATION`, `DUPLICATE`, `NOT_FOUND`, `UNAUTHORIZED` or `INTERNAL`.

---

## How the intelligence is computed

| Signal | Method |
|---|---|
| Repos analysed | `GET /orgs/{org}/repos?sort=pushed&per_page=30`, with forks and archived repos excluded. Docs, example and starter repos are deprioritised. |
| Languages | Byte counts from `/repos/{r}/languages` across the 12 most recently pushed core repos. MDX and Markdown are excluded. |
| Infrastructure | Recursive git-tree scan plus `package.json` dependencies for the 6 most-starred recently active core repos, then keyword matching on repo names, descriptions and topics. ~25 rules. |
| Microservices | **Likely** with ≥2 strong signals, **Possible** with 1. Strong signals: ≥3 Dockerfiles in separate directories, ≥3 deployable roots under `services/`, `apps/` or `cmd/`, ≥3 `.proto` files, Kubernetes or Helm manifests, or job posts mentioning microservices or distributed systems. |
| Hiring | Public Greenhouse, Ashby and Lever APIs, probed with the GitHub handle, company name and domain. Engineering roles are filtered by title (sales and solutions roles excluded). Tools are counted per posting. |
| Blog | `<link rel="alternate">` autodiscovery on the homepage and `/blog`, then common feed paths. Shows the 6 newest posts, which also go to Gemini. |
| Velocity | **High**: ≥150 commits in 30 days or ≥8 repos pushed in 7 days. **Moderate**: ≥20 commits or ≥3 repos active in 30 days. **Low**: anything less. |
| Fit score | Commit throughput 20 · active surface area 15 · CI/CD complexity 15 · microservices 10 · engineering hiring 10 · polyglot stack 10 · monorepo tooling 10 · infra depth 10 |
| Summary and hooks | Gemini Flash with a JSON response schema and a "facts only" system prompt, validated with zod. Retries once, then falls back to the template. |

Without `GITHUB_TOKEN`, scans are automatically reduced (4 language, 2 commit and 2 tree lookups) to stay within 60 requests/hr.

## Project structure

```
src/
├─ app/
│  ├─ api/            companies · enrich · cron/refresh · pitch · export · health
│  ├─ layout.tsx      theme, tooltips, toasts
│  └─ page.tsx        renders <Dashboard/>
├─ components/        dashboard, company-card, add-company-dialog, history-panel, status-strip, ui/*
├─ lib/
│  ├─ github.ts           live GitHub collection (rate-limit aware, bounded concurrency)
│  ├─ infra-detection.ts  pure rule engine → tags with evidence
│  ├─ scoring.ts          velocity + explainable fit score
│  ├─ signals.ts          live job boards (Greenhouse/Lever/Ashby) + blog feed discovery
│  ├─ gemini.ts           Gemini Flash narrative, pitch regeneration, template fallback
│  ├─ enrichment.ts       the pipeline: collect → score → narrate → upsert + snapshot
│  ├─ api.ts / client.ts  server and client helpers
│  └─ types.ts            shared types
└─ proxy.ts           optional Basic Auth
supabase/             migration + seed SQL
vercel.json           weekly cron
```
