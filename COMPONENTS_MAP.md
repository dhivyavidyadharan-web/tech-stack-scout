# Tech Stack Scout — Components Map

How Next.js, Supabase, the GitHub REST API, Google Gemini Flash and Vercel Cron fit together.

## 1. System architecture

```
                         ┌───────────────────────────────────────────────┐
                         │                 BROWSER (AE)                  │
                         │  Dashboard  (React 19 client components)      │
                         │  ├─ Header: Refresh ▾ · Export CSV · Add ⊕    │
                         │  ├─ StatusStrip  (GET /api/health)            │
                         │  ├─ Metrics + Filters (stack/velocity/sort)   │
                         │  └─ CompanyCard × N                           │
                         │       stack badges · velocity · fit ring      │
                         │       Outreach Hook (tones, copy, regenerate) │
                         │       Accordion: Context · Fit · Repos · Hist │
                         └───────────────┬───────────────────────────────┘
                                         │ fetch (JSON)   ▲ toasts on 404 / 429
                                         ▼               │
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    NEXT.JS 16 on VERCEL (App Router, Node runtime)               │
│                                                                                  │
│  src/proxy.ts ── optional Basic Auth (DASHBOARD_PASSWORD), skips /api/cron        │
│                                                                                  │
│  Route handlers (src/app/api)                                                     │
│  ┌──────────────────────────┐  ┌───────────────────────────┐  ┌───────────────┐  │
│  │ GET    /api/companies    │  │ POST /api/enrich/[id]     │  │ GET /api/cron │  │
│  │ POST   /api/companies ───┼─▶│  (also used by POST       │◀─┤   /refresh    │◀─┼── Vercel Cron
│  │ DELETE /api/companies/id │  │   /companies & cron)      │  │ Bearer secret │  │   0 0 * * 0  (stale)
│  │                          │  │                           │  │ ?mode=new     │◀─┼── 0 6 * * *  (new rows)
│  │ GET    /api/export (CSV) │  └────────────┬──────────────┘  └───────────────┘  │
│  │ POST   /api/pitch/[id]   │               │                                    │
│  │ GET    /api/health       │               ▼                                    │
│  └────────────┬─────────────┘   src/lib/enrichment.ts  (the pipeline)            │
│               │                 ┌──────────────────────────────────────────┐     │
│               │                 │ 1 collectOrgStats()      lib/github.ts   │─────┼──▶ GitHub REST API
│               │                 │   repos · languages · commits · git tree │     │   api.github.com
│               │                 │ 1b fetchHiringSignals()   lib/signals.ts │─────┼──▶ Greenhouse / Lever / Ashby
│               │                 │ 1c fetchBlogPosts()       lib/signals.ts │─────┼──▶ Company RSS / Atom feeds
│               │                 │ 2 detectInfra() + detectArchitecture()   │     │
│               │                 │ 3 velocityFrom() + fitScore() lib/scoring│     │
│               │                 │ 4 generateNarrative()    lib/gemini.ts   │─────┼──▶ Google Gemini Flash
│               │                 │ 5 upsert intel + insert snapshot         │     │   (@google/genai)
│               │                 └──────────────────┬───────────────────────┘     │
│               ▼                                    ▼                             │
│          lib/supabase.ts  (service-role client, server-only)                     │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ PostgREST (HTTPS)
                                       ▼
                ┌──────────────────────────────────────────────────┐
                │              SUPABASE (PostgreSQL 17)            │
                │  companies (+jobs_board, blog_feed_url overrides)│
                │      └──1:1── engineering_intelligence           │
                │      │                                           │
                │      └──1:N── intelligence_snapshots (history)   │
                │  view stale_companies  (refreshed > 7 days ago)  │
                │  RLS on, no public policies → anon key gets 0    │
                └──────────────────────────────────────────────────┘
```

## 2. Enrichment sequence (`POST /api/enrich/[companyId]`)

```
Client          Route handler        GitHub API                 Gemini Flash         Supabase
  │  POST            │                   │                          │                   │
  │─────────────────▶│ getCompany(id) ───┼──────────────────────────┼──────────────────▶│
  │                  │ GET /orgs/{org}  ▶│  (falls back to /users)  │                   │
  │                  │ GET /orgs/{org}/repos?sort=pushed&per_page=30│                   │
  │                  │ ─ for core repos (docs/examples deprioritised), ≤6 in parallel ─ │
  │                  │ GET /repos/{r}/languages        ×12          │                   │
  │                  │ GET /repos/{r}/commits?since=30d ×6          │                   │
  │                  │ GET /repos/{r}/git/trees/{branch}?recursive=1 ×6                 │
  │                  │ GET /repos/{r}/contents/package.json (if present)                │
  │                  │ ∥ Greenhouse/Ashby/Lever job board API · RSS/Atom feed (parallel, best-effort)
  │                  │ detectArchitecture (Dockerfiles · services/ · .proto · k8s) + job mentions
  │                  │◀──────────────────│                          │                   │
  │                  │ detectInfra · velocity · fitScore            │                   │
  │                  │ generateContent(JSON schema) ───────────────▶│                   │
  │                  │◀──── {paragraph_1, paragraph_2, pitch, 3 tone variants}          │
  │                  │ cache discovered jobs_board / blog_feed_url on companies ───────▶│
  │                  │ upsert engineering_intelligence ─────────────┼──────────────────▶│
  │                  │ insert intelligence_snapshots ───────────────┼──────────────────▶│
  │◀── 200 {intel} ──│                                              │                   │
```

Failure handling:

| Failure | Where | Result |
|---|---|---|
| Org doesn't exist | `resolveOwner` | `404 GITHUB_NOT_FOUND`, shown as a "not found" toast; nothing saved |
| Rate limit (403 with remaining=0, or 429) | `gh()` | `429 GITHUB_RATE_LIMIT` with `resetAt`, shown as a toast with the reset time; bulk refresh and cron stop early |
| Empty or unreadable repo | `ghSoft()` | That repo is skipped; the rest are still analysed |
| Gemini error, bad JSON, or no key | `generateNarrative` | One retry, then the deterministic template (`ai_model = heuristic-fallback`) |
| Job board or blog unreachable | `signals.ts` | Returns empty and the cached ref is cleared for rediscovery; GitHub enrichment still succeeds |
| Refresh fails after earlier success | `recordRefreshError` | Last good data is kept; an amber warning shows on the card |

## 3. Component tree (frontend)

| Component | File | Responsibility |
|---|---|---|
| `RootLayout` | `src/app/layout.tsx` | Fonts, `ThemeProvider` (dark mode), `TooltipProvider`, `Toaster` |
| `Dashboard` | `src/components/dashboard.tsx` | Data loading, metrics, filters/sort, bulk refresh with progress, empty/skeleton states |
| `StatusStrip` | `src/components/status-strip.tsx` | Live integration health and remaining GitHub quota |
| `AddCompanyDialog` | `src/components/add-company-dialog.tsx` | Validated add flow with suggestions; enriches straight after adding |
| `CompanyCard` | `src/components/company-card.tsx` | Stack badges with evidence tooltips, velocity tag, microservices badge, hiring signals, blog posts, fit ring, outreach hook (tones, copy, regenerate), accordions, refresh/remove actions |
| `HistoryPanel` | `src/components/history-panel.tsx` | Fit-score sparkline and diffs between snapshots ("Adopted Kubernetes", "Velocity Moderate → High", "Engineering hiring 12 → 20") |
| `ui/*` | `src/components/ui` | shadcn/ui (Base UI primitives) |

## 4. Data model

```
companies                         engineering_intelligence (1 row / company)     intelligence_snapshots (N / company)
─────────                         ─────────────────────────────────────────     ───────────────────────────────────
id           uuid PK  ◀──────┬─── company_id        uuid UNIQUE FK cascade  ┌── company_id   uuid FK cascade
name         text            │    dominant_languages  jsonb                 │   captured_at  timestamptz
domain       text            │    cloud_infra_tools   jsonb (+evidence)     │   velocity_score, fit_score,
github_org   text UNIQUE     │    velocity_score      High|Moderate|Low     │   commits_30d, active_repo_count,
created_at   timestamptz     │    active_repo_count   int                   │   dominant_languages, cloud_infra_tools
                             │    last_commit_date    timestamptz           │
                             │    engineering_summary text (2 paragraphs)   │
                             │    outreach_pitch      text                  │
                             │    last_refreshed_at   timestamptz           │
                             │    fit_score/fit_reasons, pitch_variants,    │
                             │    commits_30d, total_stars, top_repos,      │
                             │    raw_stats, ai_model, refresh_error        │
                             └──────────────────────────────────────────────┘
```

## 5. Design decisions

- **Gemini Flash is the only runtime LLM.** It's called through `@google/genai` with a JSON `responseSchema`, and the output is validated with zod. The "exactly two paragraphs" rule is enforced in code, not just requested in the prompt.
- **Gemini only sees aggregates.** It gets public GitHub facts. Signals that were only "mentioned" are labelled that way, so the model hedges instead of inventing.
- **Evidence-backed tags.** Each infra tag stores the file that proved it (`terraform-provider-aws: …/main.tf`). The UI separates *confirmed* tags (found in files) from *mentioned* ones (dashed outline), so an AE never pitches a tool the prospect doesn't actually use.
- **Noise filtering.** Docs, example and starter repos are deprioritised, and prose "languages" (MDX, Markdown) are excluded. Without this, `prisma` reads as "60% MDX" and gets an AWS tag from its examples gallery.
- **Three live sources, like a human researcher.** GitHub shows how they build, job posts show what they hire for, and the blog shows what they're shipping. Tools named in job descriptions become *confirmed* infra tags with "Jobs (greenhouse): mentioned in N postings" as the evidence.
- **Microservices from structure, not keywords.** Many Dockerfiles in separate directories, deployable roots under `services/`, `.proto` contracts and Kubernetes manifests count as strong signals. A compose file alone is weak.
- **No code needed to manage the watchlist.** Rows added in the Supabase table editor are picked up by the daily `?mode=new` cron. The `jobs_board` and `blog_feed_url` columns can be overridden by hand.
- **The fit score is explainable.** Eight weighted, capped factors (100 points total). Each reason is a sentence the AE can repeat on a call.
- **`raw_stats` is cached.** Regenerating a pitch costs one Gemini call and zero GitHub calls.
- **Security.** RLS denies everything to the anon key, the service-role key never reaches the browser, the cron route needs a bearer secret, Basic Auth is optional, and CSV export guards against formula injection.
- **Cron resilience.** Oldest companies refresh first, there's a 240s time budget under `maxDuration=300`, a rate limit stops the run early, and whatever is left gets picked up next week.
