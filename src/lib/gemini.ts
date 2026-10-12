import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { env } from "./env";
import type { PitchTone, PitchVariants, RawStats, VelocityScore } from "./types";

/**
 * All runtime LLM calls go through Google Gemini Flash (never Claude).
 * Gemini sees only aggregated, public GitHub facts — no customer data.
 */

export interface AiNarrative {
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
  paragraph_1: z.string().min(80),
  paragraph_2: z.string().min(80),
  outreach_pitch: z.string().min(20).max(320),
  pitch_technical: z.string().min(20).max(320),
  pitch_executive: z.string().min(20).max(320),
  pitch_casual: z.string().min(20).max(320),
  hook_angle: z.string().max(40).optional(),
});

const SYSTEM = `You are a senior solutions engineer helping an enterprise account executive prepare for outreach.
You write precise, factual engineering briefs grounded ONLY in the data provided. Never invent repos, tools, metrics or customers.
If a signal is marked "mentioned only", treat it as unconfirmed and hedge ("appears to", "references").
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
      status: t.confirmed ? "confirmed in files" : "mentioned only",
      evidence: t.evidence.slice(0, 2),
    })),
    github_actions_workflow_files: stats.workflowFileCount,
    flagship_repos: stats.topRepos.map((r) => `${r.name} (${r.language ?? "n/a"}, ${r.stars}★): ${r.description ?? ""}`),
    common_topics: stats.topics,
    architecture: {
      microservices: stats.architecture.microservices,
      evidence: stats.architecture.signals,
    },
    hiring: stats.hiring
      ? {
          open_engineering_roles: stats.hiring.engineeringRoles,
          total_open_roles: stats.hiring.totalRoles,
          example_titles: stats.hiring.sampleTitles,
          tools_in_job_descriptions: stats.hiring.tools.map((t) => `${t.name} (${t.count} postings)`),
        }
      : "no public job board found",
    recent_blog_posts: stats.blogPosts.slice(0, 5).map((p) => `${p.title}${p.published ? ` (${p.published.slice(0, 10)})` : ""}`),
  };
}

export interface HookAngle {
  angle: "hiring" | "blog" | "architecture" | "flagship-repo" | "language-mix" | "monorepo" | "infrastructure" | "delivery-pace";
  fact: string;
}

/**
 * Ranked, company-specific hook candidates — most distinctive first.
 * Generic signals every org has (CI workflow counts, commit totals) go last,
 * so openers don't all read "With N GitHub Actions workflows…".
 */
export function hookAngles(stats: RawStats): HookAngle[] {
  const out: HookAngle[] = [];
  const h = stats.hiring;
  if (h && h.engineeringRoles > 0) {
    const title = h.sampleTitles.find((t) => !/^(senior |staff |principal )?software engineer$/i.test(t)) ?? h.sampleTitles[0];
    const tools = h.tools.slice(0, 3).map((t) => `${t.name} (${t.count} postings)`).join(", ");
    out.push({ angle: "hiring", fact: `Hiring ${h.engineeringRoles} engineers${title ? `, including a "${title}"` : ""}${tools ? `; job descriptions cite ${tools}` : ""}` });
  }
  const recent = stats.blogPosts.find((p) => !p.published || Date.now() - new Date(p.published).getTime() < 75 * 86_400_000);
  if (recent) out.push({ angle: "blog", fact: `Recently published "${recent.title}"${recent.published ? ` (${recent.published.slice(0, 10)})` : ""}` });
  if (stats.architecture.microservices !== "Unlikely" && stats.architecture.signals[0]) {
    out.push({ angle: "architecture", fact: `Microservices ${stats.architecture.microservices.toLowerCase()}: ${stats.architecture.signals.slice(0, 2).join("; ")}` });
  }
  const flagship = stats.topRepos[0];
  if (flagship) {
    out.push({ angle: "flagship-repo", fact: `Flagship repo ${flagship.name} (${flagship.stars.toLocaleString()} stars, ${flagship.language ?? "mixed"}): ${flagship.description ?? "no description"}` });
  }
  const [top, second] = stats.languages;
  if (top && second && second.percentage >= 8) {
    out.push({ angle: "language-mix", fact: `Splits code between ${top.name} (${top.percentage}%) and ${second.name} (${second.percentage}%)` });
  }
  const mono = stats.infra.filter((t) => t.category === "Monorepo" && t.confirmed).map((t) => t.name);
  if (mono.length) out.push({ angle: "monorepo", fact: `Runs monorepo tooling: ${mono.join(", ")}` });
  const infra = stats.infra.filter((t) => t.confirmed && ["Orchestration", "IaC", "Cloud"].includes(t.category)).map((t) => t.name);
  if (infra.length) out.push({ angle: "infrastructure", fact: `Confirmed infrastructure: ${infra.slice(0, 4).join(", ")}` });
  out.push({ angle: "delivery-pace", fact: `${stats.commits30d} commits in 30 days across busiest repos; ${stats.workflowFileCount} CI workflow files` });
  return out;
}

function buildPrompt(stats: RawStats, velocity: VelocityScore): string {
  return `Seller's product: ${env.sellerProduct()}.

Public engineering intelligence (JSON):
${JSON.stringify(compactStats(stats, velocity), null, 2)}

Candidate hook angles for this company, most distinctive first:
${hookAngles(stats).map((h, i) => `${i + 1}. [${h.angle}] ${h.fact}`).join("\n")}

Write:
1. paragraph_1 (3–4 sentences): the engineering environment — dominant languages with their shares, flagship repos, architecture (microservices or not, with the evidence) and what the codebase suggests they build.
2. paragraph_2 (3–4 sentences): delivery & infrastructure — CI/CD, containers/cloud/IaC, monorepo tooling, build velocity, plus what their hiring and recent blog posts reveal about where engineering is investing — and the most likely developer-productivity friction this creates.
3. outreach_pitch: ONE sentence (max 30 words) cold-email opener built on the most distinctive candidate angle (prefer the top of the list). It must sound like it could only have been written to THIS company — name the specific role, post, repo or architecture detail. Connect it naturally to the seller's product.
4. pitch_technical, pitch_executive, pitch_casual: one sentence each for a staff engineer, a VP of Engineering, and a friendly peer. Each must use a DIFFERENT angle from the list than outreach_pitch and from each other.
5. hook_angle: the bracketed angle name outreach_pitch is built on (e.g. "hiring").

Rules for every pitch: do not open with a count of CI/GitHub Actions workflows or commits (the "delivery-pace" angle is a last resort); do not mention the product name; do not start with "I", "With", "Managing", "Following", "Scaling" or "Saw"; vary sentence structure; no generic phrases like "as your team scales".`;
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
  },
  required: ["paragraph_1", "paragraph_2", "outreach_pitch", "pitch_technical", "pitch_executive", "pitch_casual", "hook_angle"],
  propertyOrdering: ["paragraph_1", "paragraph_2", "outreach_pitch", "pitch_technical", "pitch_executive", "pitch_casual", "hook_angle"],
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
        // Enforce the "exactly two paragraphs" contract regardless of model formatting.
        summary: `${oneParagraph(parsed.paragraph_1)}\n\n${oneParagraph(parsed.paragraph_2)}`,
        pitch: oneParagraph(parsed.outreach_pitch),
        variants: {
          technical: oneParagraph(parsed.pitch_technical),
          executive: oneParagraph(parsed.pitch_executive),
          casual: oneParagraph(parsed.pitch_casual),
          angle: parsed.hook_angle?.replace(/[[\]]/g, "").trim() || undefined,
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

Candidate hook angles, most distinctive first:
${hookAngles(stats).map((h, i) => `${i + 1}. [${h.angle}] ${h.fact}`).join("\n")}

Write ONE fresh cold-email opening sentence (max 30 words) for ${TONE_GUIDE[tone]}.
Build it on a candidate angle NOT used by the previous versions below, naming the specific detail.
Do not open with CI workflow or commit counts. Do not mention the product name. Do not start with "I", "With", "Managing", "Following", "Scaling" or "Saw".
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
  return {
    summary: `${p1.replace(/\s+/g, " ").trim()}\n\n${p2.replace(/\s+/g, " ").trim()}`,
    pitch: `${hookAngles(stats)[0]?.fact ?? `${stats.commits30d} commits landed across ${detail} this month`} caught my eye — curious how much of your engineers' week goes to waiting on builds and reviews?`,
    variants: {
      technical: `With ${stats.workflowFileCount} CI workflows and ${langText} in play, how are you keeping build times flat as ${detail} grows?`,
      executive: `${name} is shipping at a ${velocity.toLowerCase()} pace across ${stats.activeRepos30d} active repos — teams at that scale usually lose hours per engineer each week to builds and reviews.`,
      casual: `Been poking around ${detail} — nice work. Out of curiosity, what's the slowest part of your dev loop right now?`,
    },
    model: "heuristic-fallback",
  };
}
