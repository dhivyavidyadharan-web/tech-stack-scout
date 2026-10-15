import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { env } from "./env";
import type { NewsItem, PitchTone, PitchVariants, RawStats, VelocityScore, WhyItMatters } from "./types";

/**
 * All runtime LLM calls go through Google Gemini Flash (never Claude).
 * Gemini sees only aggregated, public GitHub facts — no customer data.
 */

export interface AiNarrative {
  /** 1–2 sentence TL;DR shown on the card; the full summary sits behind a dropdown. */
  overview: string;
  /** Observed signal → why it matters for the seller's product. */
  whyItMatters: WhyItMatters[];
  /** What public data cannot show. */
  unknowns: string[];
  summary: string; // exactly two paragraphs separated by "\n\n"
  pitch: string;
  variants: PitchVariants;
  model: string;
}

/** Single place that builds the Gemini client, so endpoint changes are config-only. */
export function geminiClient(apiKey: string): GoogleGenAI {
  const baseUrl = env.geminiBaseUrl();
  return new GoogleGenAI({
    apiKey,
    ...(env.geminiUseVertex() ? { vertexai: true } : {}),
    ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
  });
}

const narrativeSchema = z.object({
  overview: z.string().min(30).max(400),
  paragraph_1: z.string().min(80),
  paragraph_2: z.string().min(80),
  outreach_pitch: z.string().min(20).max(320),
  pitch_technical: z.string().min(20).max(320),
  pitch_executive: z.string().min(20).max(320),
  pitch_casual: z.string().min(20).max(320),
  hook_angle: z.string().max(40).optional(),
  why_it_matters: z
    .array(z.object({ signal: z.string().min(5).max(220), relevance: z.string().min(5).max(260) }))
    .min(1)
    .max(3),
  unknowns: z.array(z.string().min(5).max(200)).min(1).max(3),
  hook_type: z.enum(["buying-signal", "context"]),
  hook_evidence: z.string().min(5).max(320),
});

const SYSTEM = `You are a senior solutions engineer helping an enterprise account executive prepare for outreach.
You write precise, factual engineering briefs grounded ONLY in the data provided. Never invent repos, tools, metrics or customers.
If a signal is marked "mentioned only", treat it as unconfirmed and hedge ("appears to", "references").
Tools "detected in public code" prove a public repository references them, not that production runs on them — describe them as observed in their public repos (e.g. "your public repos use Terraform"), never as a fact about their production infrastructure.
Activity numbers describe PUBLIC GitHub repositories only.
Numbers, names and claims from headlines must be used exactly as written — never round, re-derive or reinterpret a figure (if a headline says "58% of traffic is bots", do not turn it into a claim about deployments). When unsure what a headline means, cite it by its subject rather than its numbers.
No markdown, no bullet points, no emojis, no hype words like "revolutionize" or "game-changer".`;

function compactStats(stats: RawStats, velocity: VelocityScore) {
  return {
    organization: stats.orgName ?? stats.org,
    github_handle: stats.org,
    description: stats.orgDescription,
    public_repos: stats.publicRepos,
    repos_analyzed: stats.reposAnalyzed,
    active_repos_last_30d: stats.activeRepos30d,
    repos_pushed_last_7d: stats.pushedLast7d,
    commits_last_30d_in_busiest_repos: stats.commits30d,
    velocity,
    last_commit_at: stats.lastCommitAt,
    languages_by_code_share: stats.languages.map((l) => `${l.name} ${l.percentage}%`),
    infrastructure: stats.infra.map((t) => ({
      tool: t.name,
      category: t.category,
      status: t.confirmed ? "detected in public code or job posts" : "mentioned only",
      evidence: t.evidence.slice(0, 2),
    })),
    github_actions_workflow_files: stats.workflowFileCount,
    flagship_repos: stats.topRepos.map((r) => `${r.name} (${r.language ?? "n/a"}, ${r.stars}★): ${r.description ?? ""}`),
    common_topics: stats.topics,
    architecture: {
      microservices: stats.architecture.microservices,
      evidence: stats.architecture.signals,
    },
    hiring: stats.hiring?.totalRoles === 0
      ? "a public job board exists but lists no roles — hiring is UNKNOWN (they likely hire through another site); do not say they have zero openings"
      : stats.hiring
      ? {
          open_engineering_roles: stats.hiring.engineeringRoles,
          total_open_roles: stats.hiring.totalRoles,
          example_titles: stats.hiring.sampleTitles,
          tools_in_job_descriptions: stats.hiring.tools.map((t) => `${t.name} (${t.count} postings)`),
        }
      : "no public job board found",
    recent_blog_posts: stats.blogPosts.slice(0, 5).map((p) => `${p.title}${p.published ? ` (${p.published.slice(0, 10)})` : ""}`),
    recent_news: stats.news
      .filter((n) => n.kind === "news")
      .slice(0, 5)
      .map((n) => `${n.title} — ${n.source}${n.published ? ` (${n.published.slice(0, 10)})` : ""}`),
    hacker_news_discussions: stats.news.filter((n) => n.kind === "hn").map((n) => `${n.title} (${n.points} points)`),
    recent_releases: stats.building.releases.map((r) => `${r.repo} ${r.tag}: ${r.name} (${r.published.slice(0, 10)})`),
    new_repos_last_120d: stats.building.newRepos.map((r) => `${r.name} (${r.language ?? "n/a"}): ${r.description ?? ""}`),
  };
}

export interface HookAngle {
  /** buying-signal = suggests dev-productivity need; context = interesting, proves no need. */
  type: "buying-signal" | "context";
  angle: string;
  fact: string;
}

/**
 * Ranked hook candidates. Buying signals (evidence of developer-productivity need)
 * come first; context signals (news, funding, launches, repos) follow and may only
 * support curiosity-led openers — never an asserted pain.
 */
export function hookAngles(stats: RawStats): HookAngle[] {
  const out: HookAngle[] = stats.buyingSignals.map((b) => ({ type: "buying-signal", angle: b.kind, fact: b.fact }));
  const ctx = (angle: string, fact: string) => out.push({ type: "context", angle, fact });

  const headline = stats.news.find((n) => n.kind === "news");
  if (headline) ctx("news", `In the news: "${headline.title}" (${headline.source}${headline.published ? `, ${headline.published.slice(0, 10)}` : ""})`);
  const hn = stats.news.find((n) => n.kind === "hn" && (n.points ?? 0) >= 50);
  if (hn) ctx("news", `Trending on Hacker News: "${hn.title}" (${hn.points} points)`);
  const release = stats.building.releases[0];
  if (release) ctx("release", `Just shipped ${release.repo} ${release.tag}${release.name !== release.tag ? ` ("${release.name}")` : ""} on ${release.published.slice(0, 10)}`);
  const fresh = stats.building.newRepos[0];
  if (fresh) ctx("new-repo", `New repo ${fresh.name} created ${fresh.created.slice(0, 10)}${fresh.description ? `: ${fresh.description}` : ""}`);
  const h = stats.hiring;
  if (h && h.engineeringRoles > 0) {
    const tools = h.tools.slice(0, 3).map((t) => `${t.name} (${t.count} postings)`).join(", ");
    ctx("hiring", `Hiring ${h.engineeringRoles} engineers${tools ? `; job descriptions cite ${tools}` : ""}`);
  }
  const recent = stats.blogPosts.find((p) => !p.published || Date.now() - new Date(p.published).getTime() < 75 * 86_400_000);
  if (recent) ctx("blog", `Recently published "${recent.title}"${recent.published ? ` (${recent.published.slice(0, 10)})` : ""}`);
  const flagship = stats.topRepos[0];
  if (flagship) ctx("flagship-repo", `Flagship repo ${flagship.name} (${flagship.stars.toLocaleString()} stars, ${flagship.language ?? "mixed"}): ${flagship.description ?? "no description"}`);
  const [top, second] = stats.languages;
  if (top && second && second.percentage >= 8) ctx("language-mix", `Splits public code between ${top.name} (${top.percentage}%) and ${second.name} (${second.percentage}%)`);
  return out;
}

const angleList = (stats: RawStats) =>
  hookAngles(stats)
    .map((h, i) => `${i + 1}. [${h.type} · ${h.angle}] ${h.fact}`)
    .join("\n") || "(no candidate angles — public data is sparse)";

function buildPrompt(stats: RawStats, velocity: VelocityScore): string {
  return `Seller's product: ${env.sellerProduct()}.

Public engineering intelligence (JSON):
${JSON.stringify(compactStats(stats, velocity), null, 2)}

Candidate hook angles (buying signals first, then context):
${angleList(stats)}

Write:
0. overview: 1–2 sentences (max 45 words) an AE can skim in five seconds — what they build, their dominant stack, and the single most relevant thing they are doing right now.
1. paragraph_1 (3–4 sentences): the engineering environment — dominant languages with their shares, flagship repos, architecture (microservices or not, with the evidence) and what the codebase suggests they build.
2. paragraph_2 (3–4 sentences): delivery & infrastructure — CI/CD, containers/cloud/IaC, monorepo tooling, build velocity, plus what their hiring, recent releases, news and blog posts reveal about where engineering is investing right now — and, ONLY where a buying signal supports it, which developer-productivity friction may be present (phrased as a hypothesis, not a fact).
3. outreach_pitch: ONE sentence (max 30 words) built on the TOP candidate angle (candidates are ordered most specific first; a raw CI-workflow count is the weakest signal — use it only when nothing more specific exists).
   - [buying-signal]: you may connect it to a developer-productivity friction, but only as a question or hypothesis that cites the signal ("curious whether…", "wondering how…"). Never assert they have the problem.
   - [context]: acknowledge the event specifically and ask an open, curiosity-led question about their engineering priorities. Do NOT claim or imply that funding, an acquisition, a launch, executive commentary or traffic numbers cause CI, build or review pain.
   It must sound written only for THIS company. Do not mention the product name.
4. pitch_technical, pitch_executive, pitch_casual: one sentence each (staff engineer, VP of Engineering, friendly peer), each on a DIFFERENT angle, following the same buying-signal/context rules.
5. hook_angle: the angle name outreach_pitch is built on (e.g. "hiring").
6. why_it_matters: 1–3 items, preferring buying signals. "signal" = ONE observed fact copied from the data (number, repo, tool, role or headline). "relevance" = ONE sentence on why that fact MAY make the seller's product relevant, phrased as a hypothesis ("may", "could", "often"), never as certainty. Leave items out rather than stretch.
7. unknowns: 1–3 short items naming what public data cannot show that would confirm or refute the hypothesis (e.g. "Actual CI wait times are not public").
8. hook_type: "buying-signal" or "context" — the type of the angle outreach_pitch uses.
9. hook_evidence: the fact (copied from the candidate list) that outreach_pitch is built on.

Rules for every pitch: never invent a pain the evidence doesn't show; do not open with a bare count of CI workflows or commits; do not mention the product name; do not start with "I", "With", "Managing", "Following", "Scaling", "Saw", "Given", "Because" or "Are"; vary sentence structure; no generic phrases like "as your team scales".`;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    paragraph_1: { type: Type.STRING },
    paragraph_2: { type: Type.STRING },
    outreach_pitch: { type: Type.STRING },
    pitch_technical: { type: Type.STRING },
    pitch_executive: { type: Type.STRING },
    pitch_casual: { type: Type.STRING },
    hook_angle: { type: Type.STRING },
    overview: { type: Type.STRING },
    unknowns: { type: Type.ARRAY, items: { type: Type.STRING } },
    hook_type: { type: Type.STRING, enum: ["buying-signal", "context"] },
    hook_evidence: { type: Type.STRING },
    why_it_matters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { signal: { type: Type.STRING }, relevance: { type: Type.STRING } },
        required: ["signal", "relevance"],
      },
    },
  },
  required: ["overview", "why_it_matters", "unknowns", "hook_type", "hook_evidence", "paragraph_1", "paragraph_2", "outreach_pitch", "pitch_technical", "pitch_executive", "pitch_casual", "hook_angle"],
  propertyOrdering: [
    "overview", "why_it_matters", "unknowns", "paragraph_1", "paragraph_2",
    "outreach_pitch", "pitch_technical", "pitch_executive", "pitch_casual", "hook_angle", "hook_type", "hook_evidence",
  ],
};

const oneParagraph = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/\*\*/g, "").trim();

export async function generateNarrative(stats: RawStats, velocity: VelocityScore): Promise<AiNarrative> {
  const apiKey = env.geminiApiKey();
  if (!apiKey) return fallbackNarrative(stats, velocity);

  const ai = geminiClient(apiKey);
  const model = env.geminiModel();
  let lastError: unknown;

  // One retry: schema-constrained output is reliable, but a second attempt
  // covers transient 5xx/overload errors and the rare too-short paragraph.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: buildPrompt(stats, velocity),
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.5,
        },
      });
      const parsed = narrativeSchema.parse(JSON.parse(res.text ?? "{}"));
      return {
        overview: oneParagraph(parsed.overview),
        whyItMatters: parsed.why_it_matters.map((w) => ({ signal: oneParagraph(w.signal), relevance: oneParagraph(w.relevance) })),
        unknowns: parsed.unknowns.map(oneParagraph),
        // Enforce the "exactly two paragraphs" contract regardless of model formatting.
        summary: `${oneParagraph(parsed.paragraph_1)}\n\n${oneParagraph(parsed.paragraph_2)}`,
        pitch: oneParagraph(parsed.outreach_pitch),
        variants: {
          technical: oneParagraph(parsed.pitch_technical),
          executive: oneParagraph(parsed.pitch_executive),
          casual: oneParagraph(parsed.pitch_casual),
          angle: parsed.hook_angle?.replace(/[[\]]/g, "").replace(/^(buying-signal|context)\s*·\s*/, "").trim() || undefined,
          hookType: parsed.hook_type,
          hookEvidence: oneParagraph(parsed.hook_evidence),
        },
        model,
      };
    } catch (err) {
      lastError = err;
    }
  }
  console.error("[gemini] narrative generation failed, using fallback:", lastError);
  return fallbackNarrative(stats, velocity);
}

/**
 * News search is noisy for common-word company names. One cheap Gemini call keeps only
 * headlines about THIS company's products, engineering or business. Hacker News items
 * are already scoped to the company's domain, so they pass through untouched.
 */
export async function filterRelevantNews(
  company: { name: string; domain: string | null; description: string | null },
  items: NewsItem[],
): Promise<NewsItem[]> {
  const news = items.filter((n) => n.kind === "news");
  const apiKey = env.geminiApiKey();
  if (!apiKey || news.length === 0) return items;
  try {
    const res = await geminiClient(apiKey).models.generateContent({
      model: env.geminiModel(),
      contents: `Company: ${company.name}${company.domain ? ` (${company.domain})` : ""}${company.description ? ` — ${company.description}` : ""}

Headlines:
${news.map((n, i) => `${i}. ${n.title} — ${n.source}`).join("\n")}

Return the indexes of headlines that are genuinely about THIS company (its products, engineering, funding, acquisitions, partnerships, leadership or workforce). Exclude namesakes, unrelated people or places, generic tutorials, comparison listicles, and reviews or promotion of consumer content (shows, games, music) — the reader sells software to the engineering team.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: Type.OBJECT, properties: { relevant: { type: Type.ARRAY, items: { type: Type.INTEGER } } }, required: ["relevant"] },
        temperature: 0,
      },
    });
    const keep = new Set(z.object({ relevant: z.array(z.number().int()) }).parse(JSON.parse(res.text ?? "{}")).relevant);
    return [...news.filter((_, i) => keep.has(i)), ...items.filter((n) => n.kind === "hn")];
  } catch (err) {
    console.error("[gemini] news relevance check failed, keeping heuristic results:", err);
    return items;
  }
}

const TONE_GUIDE: Record<PitchTone, string> = {
  technical: "a staff/principal engineer: specific, technical, zero fluff",
  executive: "a VP or Director of Engineering: business outcomes — delivery speed, developer hours, risk",
  casual: "a friendly peer engineer: warm, conversational, lightly curious",
};

/** Regenerate one pitch in a given tone from cached stats — costs zero GitHub calls. */
export async function regeneratePitch(
  stats: RawStats,
  velocity: VelocityScore,
  tone: PitchTone,
  avoid: string[],
): Promise<{ pitch: string; model: string }> {
  const apiKey = env.geminiApiKey();
  if (!apiKey) {
    return { pitch: fallbackNarrative(stats, velocity).variants[tone] ?? "", model: "heuristic-fallback" };
  }
  const ai = geminiClient(apiKey);
  const model = env.geminiModel();
  const res = await ai.models.generateContent({
    model,
    contents: `Seller's product: ${env.sellerProduct()}.
GitHub intelligence (JSON):
${JSON.stringify(compactStats(stats, velocity))}

Candidate hook angles (buying signals first, then context):
${angleList(stats)}

Write ONE fresh cold-email opening sentence (max 30 words) for ${TONE_GUIDE[tone]}.
Build it on a candidate angle NOT used by the previous versions below, naming the specific detail.
A [buying-signal] may raise a developer-productivity friction only as a question; a [context] angle must stay curiosity-led and must not imply any pain.
Do not open with CI workflow or commit counts. Do not mention the product name. Do not start with "I", "With", "Managing", "Following", "Scaling", "Saw", "Given", "Because" or "Are".
Previous versions to avoid:
${avoid.map((a) => `- ${a}`).join("\n") || "- (none)"}`,
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: { pitch: { type: Type.STRING } },
        required: ["pitch"],
      },
      temperature: 0.9,
    },
  });
  const { pitch } = z.object({ pitch: z.string().min(20).max(320) }).parse(JSON.parse(res.text ?? "{}"));
  return { pitch: oneParagraph(pitch), model };
}

/**
 * Deterministic template used when GEMINI_API_KEY is missing or Gemini fails,
 * so the dashboard never shows an empty card.
 */
export function fallbackNarrative(stats: RawStats, velocity: VelocityScore): AiNarrative {
  const name = stats.orgName ?? stats.org;
  const langs = stats.languages.slice(0, 3);
  const langText = langs.length
    ? langs.map((l) => `${l.name} (${l.percentage}%)`).join(", ")
    : "a mix of languages";
  const flagship = stats.topRepos[0];
  const confirmed = stats.infra.filter((t) => t.confirmed).map((t) => t.name);
  const infraText = confirmed.length ? confirmed.slice(0, 5).join(", ") : "no confirmed container or cloud tooling in the scanned repos";
  const ci = stats.infra.find((t) => t.category === "CI/CD" && t.confirmed)?.name;

  const p1 = `${name}'s public engineering footprint spans ${stats.publicRepos} repositories, led by ${langText}. ${
    flagship ? `Its most visible project is ${flagship.name}${flagship.description ? `, ${flagship.description.replace(/\.$/, "")}` : ""}, with ${flagship.stars.toLocaleString()} stars.` : ""
  } ${stats.activeRepos30d} of the ${stats.reposAnalyzed} most recently pushed repositories saw activity in the last 30 days.`;
  const ms = stats.architecture.microservices;
  const archText =
    ms === "Unlikely"
      ? ""
      : ` The architecture ${ms === "Likely" ? "points to microservices" : "may be service-oriented"} (${stats.architecture.signals[0]}).`;
  const hiringText = stats.hiring?.engineeringRoles
    ? ` They currently list ${stats.hiring.engineeringRoles} open engineering roles${stats.hiring.tools.length ? `, with job descriptions citing ${stats.hiring.tools.slice(0, 3).map((t) => t.name).join(", ")}` : ""}.`
    : "";
  const p2 = `On the delivery side, the scanned repositories show ${infraText}${ci ? `, with ${stats.workflowFileCount} ${ci} workflow files` : ""}. Build velocity is ${velocity.toLowerCase()}, with ${stats.commits30d} commits in the busiest repositories over the past month, which typically means ${
    velocity === "High" ? "CI queue time and review latency are a daily tax on the team" : velocity === "Moderate" ? "a steady release cadence where build and review friction compounds as the team grows" : "a smaller surface where developer experience improvements can be piloted quickly"
  }.${archText}${hiringText}`;

  const detail = flagship ? `${flagship.name}` : `your ${langs[0]?.name ?? "core"} services`;
  // Without Gemini there is no namesake check on headlines, so the template never builds on news:
  // it falls back to verified GitHub releases, new repos, hiring and code facts.
  // Headline-derived signals are skipped (they could be namesakes); company-blog and HN items are domain-scoped.
  const safeAngles = hookAngles(stats).filter(
    (h) => h.angle !== "news" && !(h.angle === "content" && !/^(Blog|Hacker News):/.test(h.fact)),
  );
  const lead = safeAngles[0];
  const now = safeAngles.find((h) => ["release", "new-repo"].includes(h.angle));
  const whyItMatters: WhyItMatters[] = [
    { signal: `${stats.commits30d} commits in 30 days across the busiest repos`, relevance: "High change volume may mean CI queue time and review latency are paid many times a day." },
    ...(stats.workflowFileCount
      ? [{ signal: `${stats.workflowFileCount} CI workflow files in the top repos`, relevance: "Complex pipelines are often where faster, cached builds save the most engineering hours." }]
      : []),
    ...(stats.architecture.microservices === "Likely"
      ? [{ signal: stats.architecture.signals[0], relevance: "Many independently built services can multiply build, test and review overhead." }]
      : []),
  ].slice(0, 3);
  return {
    whyItMatters,
    unknowns: [
      "Actual CI wait times and build durations are not public",
      "Private repositories and internal tooling are not visible",
    ],
    overview: `${name} builds primarily in ${langText}${flagship ? `, led by ${flagship.name}` : ""}.${now ? ` ${now.fact}.` : ""}`.replace(/\.\./g, "."),
    summary: `${p1.replace(/\s+/g, " ").trim()}\n\n${p2.replace(/\s+/g, " ").trim()}`,
    // Buying signal → pain only as a question; context → curiosity, no pain asserted.
    pitch: lead
      ? lead.type === "buying-signal"
        ? `${lead.fact} caught my eye — curious whether build and review time is something your team is actively working on?`
        : `${lead.fact} caught my eye — what's top of mind for your engineering team this quarter?`
      : `Been reading through ${detail} — what's top of mind for your engineering team this quarter?`,
    variants: {
      technical: `With ${stats.workflowFileCount} CI workflows and ${langText} in play, how are you keeping build times flat as ${detail} grows?`,
      executive: `${name} shows ${stats.activeRepos30d} active public repos this month — curious how you think about developer time spent on builds and reviews at that pace?`,
      casual: `Been poking around ${detail} — nice work. Out of curiosity, what's the slowest part of your dev loop right now?`,
      angle: lead?.angle,
      hookType: lead?.type ?? "context",
      hookEvidence: lead?.fact,
    },
    model: "heuristic-fallback",
  };
}
