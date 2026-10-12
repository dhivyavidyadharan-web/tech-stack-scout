import type { BuyingSignal, RawStats } from "./types";

/**
 * Buying signals: observed facts that more directly suggest developer-productivity
 * NEED than raw engineering complexity does. Deterministic and evidence-linked, so
 * the opener can cite them — and when there are none, the opener stays curiosity-led.
 */
const CONTENT_RE =
  /\b(ci|continuous integration|build (times?|speed|performance|system)|faster builds?|monorepo|merge queue|flaky tests?|test (suite|speed|infrastructure)|developer (experience|productivity|velocity)|devex|code review|bazel|turborepo|nx|remote cach(e|ing)|incremental builds?|dev ?loop)\b/i;

export function deriveBuyingSignals(stats: RawStats): BuyingSignal[] {
  const out: BuyingSignal[] = [];
  const org = stats.org;

  for (const role of stats.hiring?.productivityRoles ?? []) {
    out.push({ kind: "hiring", fact: `Hiring a "${role.title}" (${stats.hiring!.provider})`, url: role.url ?? stats.hiring!.boardUrl });
  }

  // Their own words about build/CI/devex pain, from blog posts, news or HN.
  const content = [
    ...stats.blogPosts.map((p) => ({ title: p.title, url: p.url, src: "Blog" })),
    ...stats.news.map((n) => ({ title: n.title, url: n.url, src: n.kind === "hn" ? "Hacker News" : n.source })),
  ].filter((c) => CONTENT_RE.test(c.title));
  for (const c of content.slice(0, 3)) out.push({ kind: "content", fact: `${c.src}: "${c.title}"`, url: c.url });

  if (stats.workflowFileCount >= 30) {
    out.push({
      kind: "ci",
      fact: `${stats.workflowFileCount} GitHub Actions workflow files across its most-starred active public repos`,
      url: `https://github.com/${org}?tab=repositories`,
    });
  }

  const mono = stats.infra.find((t) => t.category === "Monorepo" && t.confirmed);
  if (mono) out.push({ kind: "monorepo", fact: `Monorepo tooling in public code: ${mono.name}`, url: mono.sources?.[0]?.url ?? null });

  if (stats.architecture.microservices === "Likely") {
    out.push({ kind: "architecture", fact: `Microservices likely — ${stats.architecture.signals[0]}`, url: `https://github.com/${org}?tab=repositories` });
  }
  // Most specific first: a named role or their own post beats structure; a raw CI count is the weakest.
  const rank: Record<BuyingSignal["kind"], number> = { hiring: 0, content: 1, architecture: 2, monorepo: 3, ci: 4 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 6);
}
