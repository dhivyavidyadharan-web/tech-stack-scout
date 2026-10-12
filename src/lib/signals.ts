import "server-only";
import type { BlogPost, Company, HiringSignals } from "./types";

/**
 * Two extra live sources beyond GitHub, mirroring how an AE researches manually:
 *  1. Public job postings (Greenhouse / Lever / Ashby) — what tools they hire for.
 *  2. The company's engineering blog / changelog feed — what they're shipping and talking about.
 * Both are best-effort: any failure returns null/[] and never breaks enrichment.
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
}

type Provider = HiringSignals["provider"];

async function loadBoard(provider: Provider, token: string): Promise<{ jobs: RawJob[]; boardUrl: string } | null> {
  if (provider === "greenhouse") {
    const data = await getJson<{
      jobs: { title: string; content?: string; departments?: { name: string }[] }[];
    }>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
    if (!Array.isArray(data?.jobs)) return null; // an existing board with 0 openings is still a real signal
    return {
      boardUrl: `https://job-boards.greenhouse.io/${token}`,
      jobs: data.jobs.map((j) => ({
        title: j.title,
        department: j.departments?.map((d) => d.name).join(" ") ?? "",
        // Greenhouse returns HTML-escaped HTML.
        text: stripHtml(decodeEntities(j.content ?? "")),
      })),
    };
  }
  if (provider === "lever") {
    const data = await getJson<{ text: string; categories?: { team?: string; department?: string }; descriptionPlain?: string; lists?: { content: string }[] }[]>(
      `https://api.lever.co/v0/postings/${token}?mode=json`,
    );
    if (!Array.isArray(data)) return null;
    return {
      boardUrl: `https://jobs.lever.co/${token}`,
      jobs: data.map((j) => ({
        title: j.text,
        department: `${j.categories?.department ?? ""} ${j.categories?.team ?? ""}`,
        text: `${j.descriptionPlain ?? ""} ${stripHtml(j.lists?.map((l) => l.content).join(" ") ?? "")}`,
      })),
    };
  }
  const data = await getJson<{ jobs: { title: string; department?: string; team?: string; descriptionPlain?: string; isListed?: boolean }[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${token}`,
  );
  if (!Array.isArray(data?.jobs)) return null;
  const listed = data.jobs.filter((j) => j.isListed !== false);
  return {
    boardUrl: `https://jobs.ashbyhq.com/${token}`,
    jobs: listed.map((j) => ({ title: j.title, department: `${j.department ?? ""} ${j.team ?? ""}`, text: j.descriptionPlain ?? "" })),
  };
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
  for (const j of eng) {
    const text = `${j.title} ${j.text}`;
    for (const k of JOB_KEYWORDS) if (k.re.test(text)) counts.set(k.name, (counts.get(k.name) ?? 0) + 1);
    if (MICROSERVICES_RE.test(text)) microservicesMentions++;
  }
  return {
    provider,
    boardUrl,
    totalRoles: jobs.length,
    engineeringRoles: eng.length,
    sampleTitles: [...new Set(eng.map((j) => j.title.trim()))].slice(0, 6),
    tools: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    microservicesMentions,
  };
}

/**
 * Find and analyse the company's public job board.
 * Honors `companies.jobs_board` ("greenhouse:vercel" / "none"), otherwise probes
 * Greenhouse → Ashby → Lever with name candidates. Returns the board ref to cache.
 */
export async function fetchHiringSignals(company: Company): Promise<{ hiring: HiringSignals | null; boardRef: string | null }> {
  const override = company.jobs_board?.trim();
  if (override === "none") return { hiring: null, boardRef: "none" };

  const attempts: [Provider, string][] = [];
  if (override && /^(greenhouse|lever|ashby):[\w-]+$/.test(override)) {
    const [p, t] = override.split(":") as [Provider, string];
    attempts.push([p, t]);
  } else {
    for (const t of boardCandidates(company)) {
      attempts.push(["greenhouse", t], ["ashby", t], ["lever", t]);
    }
  }

  // Probe in parallel; take the first hit in priority order.
  const results = await Promise.all(attempts.map(([p, t]) => loadBoard(p, t)));
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
    .filter((p) => p.title && p.url)
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

// ── helpers ───────────────────────────────────────────────────────────────────

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
