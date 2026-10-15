import "server-only";
import { db } from "./supabase";
import { collectOrgStats } from "./github";
import { withHiringEvidence, withJobEvidence } from "./infra-detection";
import { deriveBuyingSignals } from "./buying-signals";
import { fetchBlogPosts, fetchHiringSignals, fetchNews } from "./signals";
import { filterRelevantNews, generateNarrative } from "./gemini";
import { fitScore, velocityFrom } from "./scoring";
import type { Company, EngineeringIntelligence } from "./types";

/**
 * The full enrichment pipeline for one company:
 *   GitHub + job boards + blog + news (live, in parallel) → detect infra/architecture → score
 *   → Gemini Flash narrative → upsert + snapshot.
 * Throws GitHubError for 404 / rate limits so callers can surface precise UI states.
 */
export async function enrichCompany(company: Company): Promise<EngineeringIntelligence> {
  // GitHub is required (throws on 404/rate limit); jobs + blog are best-effort enrichments.
  const [stats, jobs, blog, news] = await Promise.all([
    collectOrgStats(company.github_org),
    fetchHiringSignals(company).catch(() => ({ hiring: null, boardRef: company.jobs_board })),
    fetchBlogPosts(company).catch(() => ({ posts: [], feedRef: company.blog_feed_url })),
    fetchNews(company).catch(() => []),
  ]);
  stats.hiring = jobs.hiring;
  stats.blogPosts = blog.posts;
  stats.news = await filterRelevantNews({ name: company.name, domain: company.domain, description: stats.orgDescription }, news);
  if (jobs.hiring) {
    stats.infra = withJobEvidence(stats.infra, jobs.hiring.tools, jobs.hiring.provider, jobs.hiring.boardUrl);
    stats.architecture = withHiringEvidence(stats.architecture, jobs.hiring.microservicesMentions, jobs.hiring.engineeringRoles);
  }

  stats.buyingSignals = deriveBuyingSignals(stats);

  const velocity = velocityFrom(stats);
  const fit = fitScore(stats);
  // Feedback loop: the last few openers Nikhil rejected steer the new one away from that style.
  const { data: rejected } = await db()
    .from("opener_feedback")
    .select("opener")
    .eq("company_id", company.id)
    .eq("rating", -1)
    .order("created_at", { ascending: false })
    .limit(5);
  const narrative = await generateNarrative(stats, velocity, (rejected ?? []).map((r) => r.opener as string));
  const now = new Date().toISOString();

  const row = {
    company_id: company.id,
    dominant_languages: stats.languages,
    cloud_infra_tools: stats.infra,
    velocity_score: velocity,
    active_repo_count: stats.activeRepos30d,
    last_commit_date: stats.lastCommitAt,
    engineering_summary: narrative.summary,
    outreach_pitch: narrative.pitch,
    last_refreshed_at: now,
    fit_score: fit.score,
    fit_reasons: fit.reasons,
    pitch_variants: narrative.variants,
    commits_30d: stats.commits30d,
    total_stars: stats.totalStars,
    top_repos: stats.topRepos,
    raw_stats: stats,
    ai_model: narrative.model,
    refresh_error: null,
    hiring_signals: stats.hiring,
    architecture: stats.architecture,
    blog_posts: stats.blogPosts,
    overview: narrative.overview,
    why_it_matters: narrative.whyItMatters,
    buying_signals: stats.buyingSignals,
    unknowns: narrative.unknowns,
    news: stats.news,
    building: stats.building,
  };

  const supabase = db();
  // Cache discovered sources so the next refresh skips probing (editable in Supabase).
  // A source that stops responding is cleared to null and rediscovered on the next refresh;
  // "none" is only ever set by a human and is respected.
  if (jobs.boardRef !== company.jobs_board || blog.feedRef !== company.blog_feed_url) {
    await supabase.from("companies").update({ jobs_board: jobs.boardRef, blog_feed_url: blog.feedRef }).eq("id", company.id);
  }

  const { data, error } = await supabase
    .from("engineering_intelligence")
    .upsert(row, { onConflict: "company_id" })
    .select()
    .single();
  if (error) throw new Error(`Failed to save intelligence: ${error.message}`);

  // History is best-effort: a failed snapshot must never fail the refresh.
  const { error: snapError } = await supabase.from("intelligence_snapshots").insert({
    company_id: company.id,
    captured_at: now,
    velocity_score: velocity,
    fit_score: fit.score,
    commits_30d: stats.commits30d,
    active_repo_count: stats.activeRepos30d,
    open_eng_roles: stats.hiring?.engineeringRoles ?? null,
    dominant_languages: stats.languages,
    cloud_infra_tools: stats.infra,
  });
  if (snapError) console.error("[enrich] snapshot insert failed:", snapError.message);

  return data as EngineeringIntelligence;
}

/** Record a failure on the intelligence row without wiping the last good data. */
export async function recordRefreshError(companyId: string, message: string) {
  await db()
    .from("engineering_intelligence")
    .upsert({ company_id: companyId, refresh_error: message }, { onConflict: "company_id" });
}
