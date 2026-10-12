"use client";

import { FileText, FolderPlus, Newspaper, Rocket, TrendingUp } from "lucide-react";
import { shortAgo } from "@/lib/client";
import type { EngineeringIntelligence } from "@/lib/types";

export interface ActivityItem {
  kind: "news" | "hn" | "release" | "repo" | "blog";
  title: string;
  url: string;
  meta: string;
  date: string | null;
}

const ICON = {
  news: Newspaper,
  hn: TrendingUp,
  release: Rocket,
  repo: FolderPlus,
  blog: FileText,
} as const;

const LABEL = {
  news: "News",
  hn: "Hacker News",
  release: "Release",
  repo: "New repo",
  blog: "Blog",
} as const;

const VERSION = /v?\d+\.\d+(?:\.\d+)?(?:[-.][\w.]+)?/;

/** "cli v3.0.0", plus the release's own title only when it says more than the version. */
function releaseTitle(repo: string, tag: string, name: string): string {
  const version = tag.match(VERSION)?.[0] ?? tag;
  const extra = name && !(name.match(VERSION)?.[0] === version || name === tag) ? ` — ${name}` : "";
  return `${repo} ${version}${extra}`;
}

/** Merge every "what are they doing now" source into one dated timeline. */
export function activityFrom(intel: EngineeringIntelligence): ActivityItem[] {
  const building = "releases" in intel.building ? intel.building : { releases: [], newRepos: [] };
  const items: ActivityItem[] = [
    ...(intel.news ?? []).map((n) => ({
      kind: n.kind,
      title: n.title,
      url: n.url,
      meta: n.kind === "hn" ? `${n.points ?? 0} points` : n.source,
      date: n.published,
    })),
    ...building.releases.map((r) => ({
      kind: "release" as const,
      title: releaseTitle(r.repo, r.tag, r.name),
      url: r.url,
      meta: "GitHub release",
      date: r.published,
    })),
    ...building.newRepos.map((r) => ({
      kind: "repo" as const,
      title: `${r.name}${r.description ? ` — ${r.description}` : ""}`,
      url: r.url,
      meta: r.language ?? "GitHub",
      date: r.created,
    })),
    ...(intel.blog_posts ?? []).map((p) => ({
      kind: "blog" as const,
      title: p.title,
      url: p.url,
      meta: "Company blog",
      date: p.published,
    })),
  ];
  // Feeds sometimes list scheduled posts with future dates — those aren't "now".
  const horizon = Date.now() + 86_400_000;
  return items
    .filter((i) => !i.date || new Date(i.date).getTime() <= horizon)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

const HIGHLIGHT_PRIORITY: ActivityItem["kind"][] = ["news", "release", "hn", "repo", "blog"];

/**
 * Card summary: the newest item of each kind, most decision-relevant kinds first,
 * so a funding round isn't pushed out by three patch releases.
 */
export function highlightsFrom(items: ActivityItem[], max = 3): ActivityItem[] {
  return HIGHLIGHT_PRIORITY.map((k) => items.find((i) => i.kind === k))
    .filter((i): i is ActivityItem => Boolean(i))
    .slice(0, max);
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No recent news, releases or posts found.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const Icon = ICON[item.kind];
        return (
          <li key={`${item.kind}:${item.url}`} className="flex items-start gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-3" aria-label={LABEL[item.kind]} />
            </span>
            <div className="min-w-0 flex-1">
              <a href={item.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-xs leading-snug hover:underline">
                {item.title}
              </a>
              <p className="text-[11px] text-muted-foreground">
                {LABEL[item.kind]} · {item.meta}
                {item.date ? ` · ${shortAgo(item.date)}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
