"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import type { ApiError, CompanyWithIntel } from "./types";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public code: ApiError["code"],
    public status: number,
    public resetAt?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (!res.ok) {
    throw new ApiClientError(body.error ?? `Request failed (${res.status})`, body.code ?? "INTERNAL", res.status, body.resetAt);
  }
  return body;
}

/** Toast with copy tailored to the failure mode (GitHub 404, rate limit, etc.). */
export function toastApiError(err: unknown, context?: string) {
  if (err instanceof ApiClientError) {
    if (err.code === "GITHUB_RATE_LIMIT") {
      const when = err.resetAt ? ` Resets ${ago(err.resetAt)}.` : "";
      toast.error("GitHub rate limit reached", { description: `${err.message}${when}`, duration: 10_000 });
      return;
    }
    if (err.code === "GITHUB_NOT_FOUND") {
      toast.error("GitHub organization not found", { description: err.message });
      return;
    }
    if (err.code === "DUPLICATE") {
      toast.info("Already tracking", { description: err.message });
      return;
    }
    toast.error(context ?? "Something went wrong", { description: err.message });
    return;
  }
  toast.error(context ?? "Network error", { description: err instanceof Error ? err.message : String(err) });
}

/** "3 hours ago" / "in 12 minutes" */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const past = d.getTime() <= Date.now();
  const dist = formatDistanceToNowStrict(d);
  return past ? `${dist} ago` : `in ${dist}`;
}

export function shortAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  return ago(iso)
    .replace(/ seconds?/, "s")
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ days?/, "d")
    .replace(/ months?/, "mo")
    .replace(/ years?/, "y");
}

export const isStale = (iso: string | null | undefined) => !iso || Date.now() - new Date(iso).getTime() > 7 * 86_400_000;

// GitHub linguist colours for the most common languages.
const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", Go: "#00ADD8", Rust: "#dea584",
  Java: "#b07219", Kotlin: "#A97BFF", Swift: "#F05138", Ruby: "#701516", PHP: "#4F5D95", "C#": "#178600",
  "C++": "#f34b7d", C: "#555555", Shell: "#89e051", HCL: "#844FBA", Elixir: "#6e4a7e", Scala: "#c22d40",
  Dart: "#00B4AB", HTML: "#e34c26", CSS: "#663399", SCSS: "#c6538c", Vue: "#41b883", Svelte: "#ff3e00",
  MDX: "#fcb32c", Dockerfile: "#384d54", PLpgSQL: "#336790", Lua: "#000080", Zig: "#ec915c", Nix: "#7e7eff",
  "Jupyter Notebook": "#DA5B0B", Makefile: "#427819", Astro: "#ff5a03", Haskell: "#5e5086", Clojure: "#db5855",
};
export const langColor = (name: string) => LANG_COLORS[name] ?? "#8b949e";

/** Plain-text account brief for email, Slack or CRM notes. */
export function buildBrief(c: CompanyWithIntel): string {
  const i = c.intelligence;
  if (!i) return `${c.name} (github.com/${c.github_org}) — not enriched yet.`;
  const langs = i.dominant_languages.slice(0, 4).map((l) => `${l.name} ${l.percentage}%`).join(", ");
  const infra = i.cloud_infra_tools.filter((t) => t.confirmed).map((t) => t.name).join(", ") || "none confirmed";
  return [
    `ACCOUNT BRIEF: ${c.name}${c.domain ? ` (${c.domain})` : ""}`,
    `GitHub: https://github.com/${c.github_org}`,
    ...(i.overview ? [``, i.overview, ``] : []),
    `Fit score: ${i.fit_score ?? "n/a"}/100 · Velocity: ${i.velocity_score ?? "n/a"} · ${i.active_repo_count} active repos · ${i.commits_30d ?? 0} commits (30d)`,
    `Languages: ${langs}`,
    `Infrastructure: ${infra}`,
    `Microservices: ${"microservices" in i.architecture ? i.architecture.microservices : "n/a"}`,
    `Hiring: ${i.hiring_signals ? `${i.hiring_signals.engineeringRoles} open engineering roles (${i.hiring_signals.tools.slice(0, 5).map((t) => t.name).join(", ")})` : "no public job board"}`,
    ...(i.news?.find((n) => n.kind === "news") ? [`In the news: ${i.news.find((n) => n.kind === "news")!.title}`] : []),
    ...(i.blog_posts?.[0] ? [`Latest post: ${i.blog_posts[0].title}`] : []),
    ``,
    `ENGINEERING CONTEXT`,
    i.engineering_summary ?? "",
    ``,
    `OPENER`,
    i.outreach_pitch ?? "",
    ``,
    `Refreshed ${ago(i.last_refreshed_at)} via Tech Stack Scout`,
  ].join("\n");
}

/** Legacy copy path for contexts where the async Clipboard API is blocked (embedded views, http). */
function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export async function copyText(text: string, label = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
    return true;
  } catch {
    if (legacyCopy(text)) {
      toast.success(label);
      return true;
    }
    toast.error("Clipboard unavailable", { description: "Your browser blocked clipboard access — select the text and copy manually." });
    return false;
  }
}
