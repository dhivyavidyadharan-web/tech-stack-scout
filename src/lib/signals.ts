import "server-only";
import type { BlogPost, Company, HiringSignals, JobPosting, NewsItem } from "./types";

/**
 * Live sources beyond GitHub, mirroring how an AE researches manually:
 *  1. Public job postings (Greenhouse / Lever / Ashby / Workable / Recruitee / SmartRecruiters)
 *     — what tools they hire for, plus the specific JDs worth reading.
 *  2. The company's engineering blog / changelog feed — what they're shipping and talking about.
 *  3. Google News + Hacker News — what they're building *now* and what engineers are discussing.
 * All are best-effort: any failure returns null/[] and never breaks enrichment.
 */

const TIMEOUT_MS = 6_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "tech-stack-scout (+https://github.com)", ...init?.headers },
    });
  } catch {
    return null;
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res?.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Candidate job-board tokens: GitHub handle, company name, domain root. */
function boardCandidates(company: Company): string[] {
  const domainRoot = company.domain?.replace(/^www\./, "").split(".")[0];
  return [...new Set([company.github_org, slug(company.name), domainRoot ? slug(domainRoot) : null].filter(Boolean))] as string[];
}

// ── Job postings ──────────────────────────────────────────────────────────────

interface RawJob {
  title: string;
  department: string;
  text: string;
  url: string | null;
}

type Provider = HiringSignals["provider"];
const PROVIDERS: Provider[] = ["greenhouse", "ashby", "lever", "workable", "recruitee", "smartrecruiters"];

/**
 * Public, key-free job-board APIs. Each returns null when the board doesn't exist,
 * and an empty list for a real board with no openings (still a useful signal).
 */
async function loadBoard(
  provider: Provider,
  token: string,
  companyName?: string,
): Promise<{ jobs: RawJob[]; boardUrl: string } | null> {
  switch (provider) {
    case "greenhouse": {
      const data = await getJson<{
        jobs: { title: string; absolute_url?: string; content?: string; departments?: { name: string }[] }[];
      }>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
      if (!Array.isArray(data?.jobs)) return null;
      return {
        boardUrl: `https://job-boards.greenhouse.io/${token}`,
        jobs: data.jobs.map((j) => ({
          title: j.title,
          department: j.departments?.map((d) => d.name).join(" ") ?? "",
          // Greenhouse returns HTML-escaped HTML.
          text: stripHtml(decodeEntities(j.content ?? "")),
          url: j.absolute_url ?? null,
        })),
      };
    }
    case "lever": {
      const data = await getJson<
        { text: string; hostedUrl?: string; categories?: { team?: string; department?: string }; descriptionPlain?: string; lists?: { content: string }[] }[]
      >(`https://api.lever.co/v0/postings/${token}?mode=json`);
      if (!Array.isArray(data)) return null;
      return {
        boardUrl: `https://jobs.lever.co/${token}`,
        jobs: data.map((j) => ({
          title: j.text,
          department: `${j.categories?.department ?? ""} ${j.categories?.team ?? ""}`,
          text: `${j.descriptionPlain ?? ""} ${stripHtml(j.lists?.map((l) => l.content).join(" ") ?? "")}`,
          url: j.hostedUrl ?? null,
        })),
      };
    }
    case "ashby": {
      const data = await getJson<{
        jobs: { title: string; jobUrl?: string; department?: string; team?: string; descriptionPlain?: string; isListed?: boolean }[];
      }>(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
      if (!Array.isArray(data?.jobs)) return null;
      return {
        boardUrl: `https://jobs.ashbyhq.com/${token}`,
        jobs: data.jobs
          .filter((j) => j.isListed !== false)
          .map((j) => ({ title: j.title, department: `${j.department ?? ""} ${j.team ?? ""}`, text: j.descriptionPlain ?? "", url: j.jobUrl ?? null })),
      };
    }
    case "workable": {
      const data = await getJson<{ name?: string; jobs: { title: string; url?: string; department?: string; description?: string }[] }>(
        `https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`,
      );
      if (!Array.isArray(data?.jobs)) return null;
      // Guessed account names can belong to someone else — require the account name to match.
      if (companyName && data.name && !namesMatch(data.name, companyName)) return null;
      return {
        boardUrl: `https://apply.workable.com/${token}/`,
        jobs: data.jobs.map((j) => ({ title: j.title, department: j.department ?? "", text: stripHtml(j.description ?? ""), url: j.url ?? null })),
      };
    }
    case "recruitee": {
      const data = await getJson<{ offers: { title: string; careers_url?: string; department?: string | null; description?: string; requirements?: string }[] }>(
        `https://${token}.recruitee.com/api/offers/`,
      );
      if (!Array.isArray(data?.offers)) return null;
      return {
        boardUrl: `https://${token}.recruitee.com/`,
        jobs: data.offers.map((j) => ({
          title: j.title,
          department: j.department ?? "",
          text: stripHtml(`${j.description ?? ""} ${j.requirements ?? ""}`),
          url: j.careers_url ?? null,
        })),
      };
    }
    case "smartrecruiters": {
      // Titles only: full descriptions need one request per posting.
      const data = await getJson<{ content: { id: string; name: string; department?: { label?: string } }[] }>(
        `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`,
      );
      if (!Array.isArray(data?.content) || data.content.length === 0) return null; // unknown ids also return []
      return {
        boardUrl: `https://careers.smartrecruiters.com/${token}`,
        jobs: data.content.map((j) => ({
          title: j.name,
          department: j.department?.label ?? "",
          text: "",
          url: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
        })),
      };
    }
  }
}

const ENG_ROLE = /\b(engineer|engineering|developer|sre|devops|platform|infrastructure|architect|security|data|machine learning|ml|software|backend|frontend|full[- ]?stack)\b/i;
// Titles that mention "platform"/"data"/etc. but aren't engineering seats.
const NON_ENG_ROLE =
  /\b(sales|solutions?|account|customer|support|success|recruit(er|ing)?|talent|marketing|partner(ships)?|legal|counsel|finance|people|developer advocate|developer relations|devrel|design engineer|product manager|program manager|project manager|product marketing|product designer|designer|technical writer|business|operations manager|chief of staff)\b/i;

/** Tools & languages worth surfacing from job descriptions. Names align with infra-detection where possible. */
const JOB_KEYWORDS: { name: string; re: RegExp }[] = [
  { name: "Kubernetes", re: /\b(kubernetes|k8s|eks|gke|aks)\b/i },
  { name: "Docker", re: /\bdocker\b/i },
  { name: "Terraform", re: /\bterraform\b/i },
  { name: "Pulumi", re: /\bpulumi\b/i },
  { name: "AWS", re: /\b(aws|amazon web services|lambda|dynamodb|ec2|s3)\b/i },
  { name: "GCP", re: /\b(gcp|google cloud|bigquery|cloud run)\b/i },
  { name: "Azure", re: /\bazure\b/i },
  { name: "Cloudflare", re: /\bcloudflare\b/i },
  { name: "GitHub Actions", re: /\bgithub actions\b/i },
  { name: "CircleCI", re: /\bcircleci\b/i },
  { name: "Bazel", re: /\bbazel\b/i },
  { name: "Kafka", re: /\bkafka\b/i },
  { name: "PostgreSQL", re: /\b(postgres|postgresql)\b/i },
  { name: "Redis", re: /\bredis\b/i },
  { name: "ClickHouse", re: /\bclickhouse\b/i },
  { name: "gRPC", re: /\bgrpc\b/i },
  { name: "GraphQL", re: /\bgraphql\b/i },
  { name: "OpenTelemetry", re: /\bopen-?telemetry\b/i },
  { name: "Datadog", re: /\bdatadog\b/i },
  { name: "Prometheus/Grafana", re: /\b(prometheus|grafana)\b/i },
  // "Go" is ambiguous in prose; require golang or Go next to list punctuation / tech context.
  { name: "Go", re: /\bgolang\b|\bGo(?=[,/)]| (?:and|or|services|backend|code|experience|developer|engineer))/ },
  { name: "Rust", re: /\brust\b/i },
  { name: "TypeScript", re: /\btypescript\b/i },
  { name: "Python", re: /\bpython\b/i },
  { name: "Java", re: /\bjava\b(?!script)/i },
  { name: "Kotlin", re: /\bkotlin\b/i },
  { name: "Elixir", re: /\belixir\b/i },
  { name: "React", re: /\breact\b/i },
  { name: "Next.js", re: /\bnext\.?js\b/i },
];
const MICROSERVICES_RE = /\b(micro-?services?|distributed systems?|service mesh|event[- ]driven)\b/i;

function summariseJobs(provider: Provider, boardUrl: string, jobs: RawJob[]): HiringSignals {
  const eng = jobs.filter((j) => ENG_ROLE.test(`${j.title} ${j.department}`) && !NON_ENG_ROLE.test(j.title));
  const counts = new Map<string, number>();
  let microservicesMentions = 0;
  const perJob: JobPosting[] = [];
  for (const j of eng) {
    const text = `${j.title} ${j.text}`;
    const tools = JOB_KEYWORDS.filter((k) => k.re.test(text)).map((k) => k.name);
    for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (MICROSERVICES_RE.test(text)) microservicesMentions++;
    perJob.push({ title: j.title.trim(), url: j.url, tools });
  }
  // The JDs worth reading before a call: most tools named, one per distinct title.
  const seen = new Set<string>();
  const matchingJobs = perJob
    .filter((j) => j.tools.length > 0)
    .sort((a, b) => b.tools.length - a.tools.length)
    .filter((j) => (seen.has(j.title) ? false : (seen.add(j.title), true)))
    .slice(0, 6);
  return {
    provider,
    boardUrl,
    totalRoles: jobs.length,
    engineeringRoles: eng.length,
    sampleTitles: [...new Set(eng.map((j) => j.title.trim()))].slice(0, 6),
    tools: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    microservicesMentions,
    matchingJobs,
  };
}

/**
 * Find and analyse the company's public job board.
 * Honors `companies.jobs_board` ("greenhouse:vercel" / "smartrecruiters:BoschGroup" / "none"),
 * otherwise probes Greenhouse → Ashby → Lever → Workable → Recruitee with name candidates.
 * Returns the board ref to cache.
 */
export async function fetchHiringSignals(company: Company): Promise<{ hiring: HiringSignals | null; boardRef: string | null }> {
  const override = company.jobs_board?.trim();
  if (override === "none") return { hiring: null, boardRef: "none" };

  const attempts: [Provider, string][] = [];
  const overrideMatch = override?.match(/^(greenhouse|lever|ashby|workable|recruitee|smartrecruiters):([\w.-]+)$/);
  if (overrideMatch) {
    attempts.push([overrideMatch[1] as Provider, overrideMatch[2]]);
  } else {
    // SmartRecruiters ids are case-sensitive company names, so it is only used via an explicit override.
    for (const t of boardCandidates(company)) {
      for (const p of PROVIDERS.filter((p) => p !== "smartrecruiters")) attempts.push([p, t]);
    }
  }

  // Probe in parallel; take the first hit in priority order.
  // Explicit overrides are trusted; guesses are name-checked where the API exposes the owner.
  const results = await Promise.all(attempts.map(([p, t]) => loadBoard(p, t, overrideMatch ? undefined : company.name)));
  // Prefer a board with openings; fall back to an existing-but-empty board.
  let idx = results.findIndex((r) => r && r.jobs.length > 0);
  if (idx === -1) idx = results.findIndex(Boolean);
  // Misses clear the cache (null), so the next refresh rediscovers — e.g. a board created or moved later.
  if (idx === -1) return { hiring: null, boardRef: null };
  const [provider, token] = attempts[idx];
  const board = results[idx]!;
  return { hiring: summariseJobs(provider, board.boardUrl, board.jobs), boardRef: `${provider}:${token}` };
}

// ── Engineering blog / changelog ──────────────────────────────────────────────

const FEED_PATHS = ["/blog/rss.xml", "/rss.xml", "/atom", "/feed", "/blog/feed", "/feed.xml", "/blog/feed.xml", "/blog/atom.xml", "/index.xml"];

function looksLikeFeed(body: string) {
  return /<(rss|feed)[\s>]/i.test(body.slice(0, 2000));
}

function parseFeed(xml: string): BlogPost[] {
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return items
    .map((item) => {
      const title = decodeEntities(stripCdata(item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")).replace(/<[^>]+>/g, "").trim();
      const url =
        item.match(/<link[^>]*href="([^"]+)"/i)?.[1] ??
        stripCdata(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim();
      const date = item.match(/<(pubDate|published|updated|dc:date)>([\s\S]*?)<\/\1>/i)?.[2]?.trim();
      const parsed = date ? new Date(date) : null;
      return { title, url, published: parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null };
    })
    // Drop scheduled posts dated in the future.
    .filter((p) => p.title && p.url && (!p.published || new Date(p.published).getTime() <= Date.now() + 86_400_000))
    .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
    .slice(0, 6);
}

async function tryFeed(url: string): Promise<BlogPost[] | null> {
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  if (!res?.ok) return null;
  const body = await res.text();
  if (!looksLikeFeed(body)) return null;
  const posts = parseFeed(body);
  return posts.length ? posts : null;
}

/** Honors `companies.blog_feed_url`, else autodiscovers via <link rel="alternate"> and common paths. */
export async function fetchBlogPosts(company: Company): Promise<{ posts: BlogPost[]; feedRef: string | null }> {
  const override = company.blog_feed_url?.trim();
  if (override === "none") return { posts: [], feedRef: "none" };
  if (override) {
    const posts = await tryFeed(override);
    if (posts) return { posts, feedRef: override };
  }
  if (!company.domain) return { posts: [], feedRef: null };

  const origin = `https://${company.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
  const candidates = new Set<string>();

  // 1. HTML autodiscovery on the homepage and /blog (fetched in parallel).
  const pages = [origin, `${origin}/blog`];
  const htmls = await Promise.all(
    pages.map(async (page) => {
      const res = await fetchWithTimeout(page, { headers: { Accept: "text/html" } });
      return res?.ok ? (await res.text()).slice(0, 200_000) : "";
    }),
  );
  htmls.forEach((html, i) => {
    for (const m of html.matchAll(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*>/gi)) {
      const href = m[0].match(/href="([^"]+)"/i)?.[1];
      if (href) candidates.add(new URL(decodeEntities(href), pages[i]).toString());
    }
  });
  // 2. Common feed paths (blog first), plus a blog. subdomain.
  for (const p of FEED_PATHS) candidates.add(`${origin}${p}`);
  candidates.add(`https://blog.${company.domain.replace(/^www\./, "")}/feed/`);

  const list = [...candidates].slice(0, 14);
  const results = await Promise.all(list.map(tryFeed));
  const idx = results.findIndex(Boolean);
  return idx === -1 ? { posts: [], feedRef: null } : { posts: results[idx]!, feedRef: list[idx] };
}

// ── News: Google News RSS + Hacker News ──────────────────────────────────────

const NEWS_WINDOW_DAYS = 60;

/** Google News RSS search — free, keyless. Titles arrive as "Headline - Publisher". */
async function googleNews(company: Company): Promise<NewsItem[]> {
  const override = company.news_query?.trim();
  if (override === "none") return [];
  const name = company.name.replace(/,?\s+(Inc|Labs|LLC|Ltd)\.?$/i, "");
  // Tech/business context keeps namesakes out ("postman" the mail carrier, "Prisma" the REIT).
  const query = override || `"${name}" (software OR developer OR developers OR engineering OR API OR cloud OR AI OR platform OR launches OR raises OR acquires OR "open source")`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${NEWS_WINDOW_DAYS}d`)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/rss+xml" } });
  if (!res?.ok) return [];
  const xml = await res.text();
  // The company must appear in the headline as a proper noun (case-sensitive), not a common word.
  const keyword = override ? (override.match(/"([^"]+)"/)?.[1] ?? override.split(/\s+/)[0]) : name;
  const nameRe = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, override ? "i" : "");
  const seen = new Set<string>();
  return (xml.match(/<item>[\s\S]*?<\/item>/g) ?? [])
    .map((item) => {
      const raw = decodeEntities(stripCdata(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")).trim();
      let source = decodeEntities(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "").trim();
      const title = source && raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw;
      if (/^https?:\/\//.test(source)) source = source.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
      const date = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
      const parsed = date ? new Date(date) : null;
      return {
        title,
        url: (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim(),
        source: source || "Google News",
        published: parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null,
        kind: "news" as const,
      };
    })
    .filter((n) => n.title && n.url && nameRe.test(n.title) && !LOW_SIGNAL_HEADLINE.test(n.title))
    // Syndicated duplicates share a headline prefix.
    .filter((n) => {
      const key = n.title.toLowerCase().slice(0, 48);
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
    .slice(0, 8);
}

/** Tutorials, comparisons and SEO listicles say nothing about what the company itself is doing. */
const LOW_SIGNAL_HEADLINE = /\[\d{4}\]|\bhow to\b|\bvs\.?\s|\bin \d+ steps\b|\b\d+ steps\b|\btutorial\b|\bbest .* alternatives\b|\bstock (price|forecast)\b|\breview:/i;

/** Hacker News stories linking to the company's domain — what engineers are discussing. */
async function hackerNews(company: Company): Promise<NewsItem[]> {
  if (!company.domain) return [];
  const domain = company.domain.replace(/^www\./, "");
  const since = Math.floor(Date.now() / 1000) - 120 * 86_400;
  const data = await getJson<{ hits: { title: string; url: string | null; points: number; created_at: string; objectID: string }[] }>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${since},points>=5`)}&hitsPerPage=20`,
  );
  return (data?.hits ?? [])
    .filter((h) => h.url && new URL(h.url).hostname.endsWith(domain))
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)
    .map((h) => ({
      title: h.title,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "Hacker News",
      published: h.created_at,
      kind: "hn" as const,
      points: h.points,
    }));
}

export async function fetchNews(company: Company): Promise<NewsItem[]> {
  const [news, hn] = await Promise.all([googleNews(company).catch(() => []), hackerNews(company).catch(() => [])]);
  return [...news, ...hn];
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** "Datadog, Inc." ~ "Datadog" ~ "datadog-hq": compare the alphanumeric stems. */
function namesMatch(a: string, b: string) {
  const x = slug(a.replace(/,?\s+(inc|labs|llc|ltd|gmbh|corp)\.?$/i, ""));
  const y = slug(b.replace(/,?\s+(inc|labs|llc|ltd|gmbh|corp)\.?$/i, ""));
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCdata(s: string) {
  return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function decodeEntities(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}
