import "server-only";
import { env } from "./env";
import { detectArchitecture, detectInfra, type RepoSignals } from "./infra-detection";
import type { LanguageShare, RawStats, TopRepo } from "./types";

const API = "https://api.github.com";
const DAY = 86_400_000;

/** Prose/markup "languages" that say nothing about the engineering stack. */
const NON_CODE_LANGUAGES = new Set(["MDX", "Markdown", "reStructuredText", "AsciiDoc", "TeX", "Text", "Roff"]);

/**
 * Docs sites, example galleries and starters skew both language share and infra
 * signals (e.g. "prisma-examples" ships AWS Lambda demos — that's not Prisma's infra).
 * They're deprioritised, not dropped, so tiny orgs still get analysed.
 */
const NOISE_REPO = /(^|[-_.])(examples?|demos?|samples?|templates?|starters?|tutorials?|playground|docs?|website|blog|awesome|\.github)([-_.]|$)/i;
const coreFirst = <T extends { name: string }>(list: T[]) =>
  [...list.filter((r) => !NOISE_REPO.test(r.name)), ...list.filter((r) => NOISE_REPO.test(r.name))];

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: "GITHUB_NOT_FOUND" | "GITHUB_RATE_LIMIT" | "GITHUB_ERROR",
    public resetAt?: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

interface GhOwner {
  login: string;
  name: string | null;
  description?: string | null;
  bio?: string | null;
  blog: string | null;
  public_repos: number;
  type: "Organization" | "User";
}

interface GhRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  size: number;
  fork: boolean;
  archived: boolean;
  topics?: string[];
  default_branch: string;
}

async function gh<T>(path: string): Promise<T> {
  const token = env.githubToken();
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tech-stack-scout",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

  if (res.ok) return (await res.json()) as T;

  if (res.status === 404) {
    throw new GitHubError(`GitHub resource not found: ${path}`, 404, "GITHUB_NOT_FOUND");
  }
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 429 || (res.status === 403 && remaining === "0")) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const resetAt = reset ? new Date(reset * 1000).toISOString() : undefined;
    throw new GitHubError(
      token
        ? "GitHub API rate limit reached."
        : "GitHub API rate limit reached (unauthenticated: 60 req/hr). Add GITHUB_TOKEN to raise it to 5,000.",
      429,
      "GITHUB_RATE_LIMIT",
      resetAt,
    );
  }
  throw new GitHubError(`GitHub API error ${res.status} on ${path}`, res.status, "GITHUB_ERROR");
}

/** Like gh(), but swallows per-repo failures (empty repos, 409s, 404s) — never rate limits. */
async function ghSoft<T>(path: string): Promise<T | null> {
  try {
    return await gh<T>(path);
  } catch (err) {
    if (err instanceof GitHubError && err.code === "GITHUB_RATE_LIMIT") throw err;
    return null;
  }
}

/** Run async work with bounded concurrency to stay polite to the GitHub API. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Resolve a GitHub handle. Tries /orgs first, then /users so that companies
 * publishing from a user account still work. Throws GITHUB_NOT_FOUND if neither exists.
 */
export async function resolveOwner(handle: string): Promise<GhOwner> {
  const clean = handle.trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//i, "").split("/")[0];
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(clean)) {
    throw new GitHubError(`"${handle}" is not a valid GitHub handle.`, 404, "GITHUB_NOT_FOUND");
  }
  try {
    const org = await gh<GhOwner>(`/orgs/${clean}`);
    return { ...org, type: "Organization" };
  } catch (err) {
    if (!(err instanceof GitHubError) || err.code !== "GITHUB_NOT_FOUND") throw err;
    try {
      return await gh<GhOwner>(`/users/${clean}`);
    } catch (userErr) {
      if (userErr instanceof GitHubError && userErr.code === "GITHUB_NOT_FOUND") {
        throw new GitHubError(`No GitHub organization named "${clean}" exists.`, 404, "GITHUB_NOT_FOUND");
      }
      throw userErr;
    }
  }
}

interface TreeResponse {
  tree: { path: string; type: "blob" | "tree" }[];
  truncated: boolean;
}

interface ContentResponse {
  content?: string;
  encoding?: string;
}

async function readPackageJsonDeps(fullName: string): Promise<string[]> {
  const file = await ghSoft<ContentResponse>(`/repos/${fullName}/contents/package.json`);
  if (!file?.content || file.encoding !== "base64") return [];
  try {
    const pkg = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
  } catch {
    return [];
  }
}

/**
 * Collect everything the enrichment pipeline needs about an org:
 *  1. 30 most recently pushed repos (spec endpoint)
 *  2. byte-level language distribution for the most active repos
 *  3. commit timestamps over the last 30 days
 *  4. deep manifest scan (full file tree + package.json) for infra signals
 */
export async function collectOrgStats(handle: string): Promise<RawStats> {
  const owner = await resolveOwner(handle);
  const login = owner.login;
  const reposPath =
    owner.type === "Organization"
      ? `/orgs/${login}/repos?sort=pushed&per_page=30`
      : `/users/${login}/repos?sort=pushed&per_page=30`;
  const allRepos = await gh<GhRepo[]>(reposPath);

  const now = Date.now();
  const repos = allRepos.filter((r) => !r.fork && !r.archived);
  const analyzed = repos.length > 0 ? repos : allRepos;
  const age = (iso: string) => now - new Date(iso).getTime();

  const activeRepos30d = analyzed.filter((r) => age(r.pushed_at) <= 30 * DAY).length;
  const pushedLast7d = analyzed.filter((r) => age(r.pushed_at) <= 7 * DAY).length;
  const lastPushAt = analyzed[0]?.pushed_at ?? null;
  const totalStars = analyzed.reduce((s, r) => s + r.stargazers_count, 0);

  // Budget requests: unauthenticated GitHub only allows 60/hr.
  const authed = Boolean(env.githubToken());
  const core = coreFirst(analyzed); // keeps pushed-recency order within each group
  const langRepos = core.slice(0, authed ? 12 : 4);
  const commitRepos = core.slice(0, authed ? 6 : 2);
  // Deep-scan the most significant *recently active* core repos (stars break ties).
  const deepRepos = coreFirst(
    analyzed.filter((r) => age(r.pushed_at) <= 120 * DAY).sort((a, b) => b.stargazers_count - a.stargazers_count),
  ).slice(0, authed ? 6 : 2);

  const since = new Date(now - 30 * DAY).toISOString();

  const [langResults, commitResults, deepResults] = await Promise.all([
    pool(langRepos, 6, (r) => ghSoft<Record<string, number>>(`/repos/${r.full_name}/languages`)),
    pool(commitRepos, 6, (r) =>
      ghSoft<{ commit: { committer: { date: string } | null } }[]>(
        `/repos/${r.full_name}/commits?since=${since}&per_page=100`,
      ),
    ),
    pool(deepRepos, 4, async (r): Promise<RepoSignals> => {
      const tree = await ghSoft<TreeResponse>(
        `/repos/${r.full_name}/git/trees/${encodeURIComponent(r.default_branch)}?recursive=1`,
      );
      const paths = tree?.tree.filter((t) => t.type === "blob").map((t) => t.path) ?? [];
      const deps = paths.includes("package.json") ? await readPackageJsonDeps(r.full_name) : [];
      return { repo: r.name, paths, deps, text: "" };
    }),
  ]);

  // Languages — aggregate bytes; fall back to primary language × repo size.
  const bytes = new Map<string, number>();
  langRepos.forEach((repo, i) => {
    const langs = langResults[i];
    if (langs && Object.keys(langs).length) {
      for (const [lang, b] of Object.entries(langs)) {
        if (!NON_CODE_LANGUAGES.has(lang)) bytes.set(lang, (bytes.get(lang) ?? 0) + b);
      }
    } else if (repo.language && !NON_CODE_LANGUAGES.has(repo.language)) {
      bytes.set(repo.language, (bytes.get(repo.language) ?? 0) + repo.size * 1024);
    }
  });
  const totalBytes = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
  const languages: LanguageShare[] = [...bytes.entries()]
    .map(([name, b]) => ({ name, bytes: b, percentage: Math.round((b / totalBytes) * 1000) / 10 }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);

  // Commits
  let commits30d = 0;
  let lastCommitAt: string | null = null;
  for (const list of commitResults) {
    if (!list) continue;
    commits30d += list.length;
    for (const c of list) {
      const d = c.commit.committer?.date;
      if (d && (!lastCommitAt || d > lastCommitAt)) lastCommitAt = d;
    }
  }

  // Infra: deep scans + shallow signals from names/descriptions/topics of all 30 repos.
  const shallow: RepoSignals[] = analyzed.filter((r) => !NOISE_REPO.test(r.name)).map((r) => ({
    repo: r.name,
    paths: [],
    deps: [],
    text: [r.name, r.description ?? "", ...(r.topics ?? [])].join(" "),
  }));
  const infra = detectInfra([...deepResults, ...shallow]);
  const workflowFileCount = deepResults.reduce(
    (n, r) => n + r.paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).length,
    0,
  );

  const topicCounts = new Map<string, number>();
  analyzed.flatMap((r) => r.topics ?? []).forEach((t) => topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1));
  const topics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([t]) => t);

  const topRepos: TopRepo[] = [...analyzed]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      url: r.html_url,
      language: r.language,
      stars: r.stargazers_count,
      pushed_at: r.pushed_at,
      description: r.description,
    }));

  return {
    org: login.toLowerCase(),
    orgName: owner.name,
    orgDescription: owner.description ?? owner.bio ?? null,
    publicRepos: owner.public_repos,
    reposAnalyzed: analyzed.length,
    deepScannedRepos: deepRepos.map((r) => r.name),
    activeRepos30d,
    pushedLast7d,
    commits30d,
    workflowFileCount,
    totalStars,
    lastPushAt,
    lastCommitAt: lastCommitAt ?? lastPushAt,
    languages,
    infra,
    topRepos,
    topics,
    architecture: detectArchitecture(deepResults),
    // Filled in by the enrichment pipeline from non-GitHub sources.
    hiring: null,
    blogPosts: [],
  };
}
