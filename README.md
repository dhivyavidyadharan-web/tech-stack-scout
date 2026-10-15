# Dora · Tech Stack Scout

**Dora** is a sales intelligence dashboard for enterprise Account Executives who sell developer productivity tools. For every target account it pulls **live GitHub data** and shows:

- **Dominant languages**, by share of code bytes (docs and prose excluded)
- **Cloud and infrastructure tooling**: Docker, Kubernetes, Terraform, AWS, GCP, GitHub Actions, Turborepo, and more. Each tag comes with file-level evidence and is marked *confirmed* or *mentioned*.
- **Build velocity** (High / Moderate / Low), based on commit and push recency
- **A two-paragraph engineering summary**, written by **Google Gemini Flash**
- **A tailored outreach opener**, plus technical, executive and casual versions you can regenerate and copy in one click
- **Microservices detection**: structural evidence (multiple Dockerfiles, deployable `services/` roots, Protobuf/gRPC contracts, Kubernetes manifests) plus job-post mentions
- **Hiring signals** from live public job boards (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters): open engineering roles, the tools named in job descriptions, and links to the **matching job posts** worth reading before a call
- **"Building now"**: what the company is shipping *this month*, from **Google News**, **Hacker News**, **GitHub releases**, **newly created repos** and the company's **engineering blog** (RSS or Atom)
- **A 1–2 sentence overview** on every card, with the full two-paragraph Gemini summary one click away
- **Filters by language and by cloud/services**, plus velocity, microservices/hiring, and full-text search across companies, languages and tools
- **Engineering complexity (0–100)** with a plain-language breakdown, kept separate from **Buying signals** (evidence of actual need), a **change history** between refreshes, **CSV export** and a one-click **account brief**

Built with Next.js 16 (App Router, TypeScript, Tailwind v4, shadcn/ui), Supabase Postgres, the GitHub REST API, Gemini Flash and Vercel Cron.

### The dashboard

- **Gradient stat tiles** with count-up numbers and mini charts: accounts and hiring, high velocity, average fit, signals this week
- **Market pulse:** weekly news, releases and blog activity across the watchlist (area chart with crosshair tooltip)
- **Stack mix:** donut of confirmed infrastructure signals, with a value table
- **Live feed:** cross-account timeline. New items flash after each background sync (every 60s while the tab is visible, and straight away when you return to it).
- **Headline ticker**, a **leaderboard** ranked by fit (click a row to jump to the account), and a **"Live · synced 12s ago"** indicator
- **Design:** baby pink × emerald × olive, with Fraunces + Plus Jakarta Sans, a grain texture and slowly drifting glows. All motion respects `prefers-reduced-motion`.
- **Chart colours** come from a categorical palette checked with a colour-vision-deficiency validator for both light and dark surfaces. Pink and emerald are separated by lightness, so red-green colour-blind readers can still tell them apart.

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
3. [`supabase/migrations/20261012020000_news_activity_overview.sql`](supabase/migrations/20261012020000_news_activity_overview.sql) adds the news, releases, overview and `news_query` columns.
4. [`supabase/seed.sql`](supabase/seed.sql) adds five seed accounts: Supabase, Vercel, Postman, HashiCorp and Prisma.

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
| `GEMINI_MODEL` | optional | default `gemini-flash-latest` | Google's rolling alias for the newest Flash model. At submission (Oct 2026) it resolves to **`gemini-3.8-flash`**. Set e.g. `GEMINI_MODEL=gemini-3.8-flash` to pin it. |
| `DASHBOARD_PASSWORD` | optional | any string | Enables HTTP Basic Auth on the whole app (any username) |
| `SELLER_PRODUCT_DESCRIPTION` | optional | free text | Describes what you sell; every opener is tailored to it |

### Managing the watchlist in Supabase (no code)

Nikhil can manage everything from the **Supabase Table Editor → `companies`**:

| Action | How |
|---|---|
| Add a company | Insert a row with `name` and `github_org` (lowercase). The daily cron enriches it within 24 hours, or click **Enrich now** on the dashboard. |
| Remove a company | Delete the row. Its intelligence and history are deleted with it. |
| Fix a job board | Set `jobs_board` to `greenhouse:`, `lever:`, `ashby:`, `workable:`, `recruitee:` or `smartrecruiters:` followed by the board id, or `none` to disable it. |
| Fix a blog feed | Set `blog_feed_url` to an RSS or Atom URL, or `none` to disable it. |
| Fix news for an ambiguous name | Set `news_query`, e.g. `"Prisma" (ORM OR database)`, or `none` to disable it. |

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

## Trust & evidence (why a rep can rely on it before a call)

- **Every claim links to its proof.** Each card's *Evidence & sources* panel lists every technology claim with its type (**Repo file**, **Dependency**, **Job posting**, **Measured** or **Mention only**), a clickable link to the exact GitHub file, `package.json`, job board or repo, and the date observed. A "mention only" signal is never counted as confirmed.
- **Observation → relevance → opener.** Each card shows *Why it matters for your product*: 2–3 Gemini-written pairs that tie one observed fact (a number, repo, tool, role or headline) to the specific friction the seller's product removes, followed by the outreach opener.
- **Freshness is visible.** A per-account source row (GitHub ✓ · Jobs · Blog ✓ · News 8 · HN 2 · Gemini) shows what the last refresh actually used. The status strip shows the next scheduled weekly refresh, and the "Live · synced Xs ago" badge shows the last client sync.
- **Server-rendered.** The first HTML response already contains every account, summary, opener and evidence item, so the product is complete even before JavaScript runs.

## Security & abuse protection

The dashboard is intentionally open, with no login, so reviewers can use every feature. The write and enrich API is still protected:

- **Same-site check:** `POST`/`DELETE` requests from another website's origin are rejected with `403`, so other pages can't drive the API from a visitor's browser.
- **Rate limits** per IP and globally (10-minute windows), stored in Supabase so they hold across serverless instances: add 6/40 · delete 10/40 · enrich 40/120 · pitch 20/80. Over the limit you get `429 RATE_LIMITED` and a toast.
- **Watchlist cap** of 30 accounts (`LIMIT_REACHED`).
- **Secrets stay server-side:** the service-role key, GitHub token and Gemini key never reach the browser, and RLS denies the public anon key. The cron route needs `CRON_SECRET`.
- **Optional login:** set `DASHBOARD_PASSWORD` to put the whole app behind Basic Auth.

## From evidence to opener (how Dora avoids inventing pain)

Dora separates three things that are easy to blur:

| Layer | What it is | Example |
|---|---|---|
| **Engineering complexity** (0–100) | How much build, CI and review load the public signals suggest. 8 weighted factors, each with its contribution shown. | Vercel 98 |
| **Buying signals** | Observed evidence that more directly suggests developer-productivity *need*, each linked to its source. In order of strength: hiring for platform, devex, build, CI or SRE roles; their own posts about builds, CI or devex; microservices; monorepo tooling; and (weakest) heavy CI setups. | Notion: hiring "Software Engineer, Developer Experience" |
| **Context signals** | Interesting but not evidence of need: funding, acquisitions, launches, executive commentary. | "Supabase raises $150M" |

**Opener rules, enforced in the Gemini prompt and the template fallback:**
- Built on a buying signal → a friction may be raised only as a question that cites the signal.
- Built on a context signal → curiosity-led, with no pain asserted or implied.
- Each card shows which type the opener used and the exact evidence behind it.

"Why it may matter" tags every line as **Observed** (in the data) or **Hypothesis** (reasoning), and an **Unknowns** box lists what public data can't show (e.g. real CI wait times, private repos).

**Sparse-data test:** Notion has almost no public GitHub activity (0 commits in 30 days, Low velocity, complexity 29) but strong buying signals (it's hiring Developer Platform and Developer Experience engineers). That's why complexity and need are shown separately.

## Honest labelling (what the numbers do and don't mean)

- **Engineering complexity is not purchase likelihood.** It's a prioritisation hypothesis built from 8 transparent, weighted public engineering signals (stored as `fit_score`), and each card shows the breakdown. Buying signals are the evidence of need. Both should be validated against real deal outcomes.
- **Velocity is observed *public* GitHub activity.** Private repositories aren't visible, so closed-source teams can look quieter than they are.
- **"Detected in public code" ≠ "runs in production".** Evidence labels say exactly what was observed (in public code, in dependencies, in job posts, mentioned only), and Gemini is told to phrase infrastructure as "seen in your public repos".
- **The template fallback never uses news.** Without Gemini's company-relevance check, the opener is built only from verified GitHub releases, repos, hiring and code facts. Template output is badged "Template summary".

## Data sources: what we use and why

Tech Stack Scout automates the three research tasks an AE currently does by hand.

| Manual task | Source used | Why this one | Considered and rejected |
|---|---|---|---|
| Reading public code repositories | **GitHub REST API**: repos, languages, commits, recursive file trees, `package.json`, releases | The ground truth of how a team builds, with file-level evidence for every tag | GitLab and Bitbucket (most target accounts publish on GitHub; easy to add later) |
| Reading job descriptions | **Greenhouse, Lever, Ashby, Workable, Recruitee** public job APIs, plus **SmartRecruiters** via override | Free and keyless; together they cover most tech-company careers pages. Guessed Workable accounts are name-checked against the company. | **LinkedIn / Indeed**: no public jobs API, and scraping breaks their terms |
| Engineering blogs and "what are they building" | Company **RSS/Atom** feed (autodiscovered), **Google News RSS**, **Hacker News (Algolia API)** | All free and keyless. News covers launches, funding and M&A; HN shows which posts engineers actually discuss. | **Reddit**: API needs OAuth approval, and commercial use needs a paid agreement. **Quora**: no API, and scraping breaks its terms. |

**News quality controls.** Common-word names ("Postman", "Prisma") produce lots of namesake headlines, so news goes through four filters:
1. The search adds tech and business context.
2. The company name must appear in the headline as a proper noun (case-sensitive).
3. Tutorials, "X vs Y" pieces and SEO listicles are dropped.
4. A temperature-0 Gemini Flash call keeps only headlines about *this* company.

You can override the search per company with `news_query` in Supabase.

**People.** Proper contact data (title, email) needs a paid provider such as Apollo or People Data Labs. The free, public option is the top contributors on a company's main GitHub repos (handle and profile only). Neither is enabled yet.

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
| Engineering complexity | Commit throughput 20 · active surface area 15 · CI/CD complexity 15 · microservices 10 · engineering hiring 10 · polyglot stack 10 · monorepo tooling 10 · infra depth 10 |
| Summary and hooks | Gemini Flash with a JSON response schema and a "facts only" system prompt, validated with zod. Retries once, then falls back to the template. |

Without `GITHUB_TOKEN`, scans are automatically reduced (4 language, 2 commit and 2 tree lookups) to stay within 60 requests/hr.

## Project structure

```
src/
├─ app/
│  ├─ api/            companies · enrich · cron/refresh · pitch · export · health
│  ├─ layout.tsx      theme, tooltips, toasts
│  └─ page.tsx        renders <Dashboard/>
├─ components/        dashboard, company-card, activity-feed, add-company-dialog, history-panel, status-strip, ui/*
├─ lib/
│  ├─ github.ts           live GitHub collection (rate-limit aware, bounded concurrency)
│  ├─ infra-detection.ts  pure rule engine → tags with evidence
│  ├─ scoring.ts          velocity + explainable fit score
│  ├─ signals.ts          job boards (6 providers) · blog feed discovery · Google News · Hacker News
│  ├─ gemini.ts           Gemini Flash narrative, pitch regeneration, template fallback
│  ├─ enrichment.ts       the pipeline: collect → score → narrate → upsert + snapshot
│  ├─ api.ts / client.ts  server and client helpers
│  └─ types.ts            shared types
└─ proxy.ts           optional Basic Auth
supabase/             migration + seed SQL
vercel.json           weekly cron
```
