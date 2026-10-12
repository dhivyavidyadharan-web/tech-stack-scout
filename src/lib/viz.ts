import type { CompanyWithIntel, InfraCategory } from "./types";
import { activityFrom, type ActivityItem } from "@/components/activity-feed";

/**
 * Chart data derivations. Colors are referenced by role (CSS custom properties
 * --series-1…6 in globals.css, validated for light AND dark surfaces) and assigned
 * by entity in a fixed order — never by rank, so filtering never repaints a series.
 */
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];

export interface CompanyActivity extends ActivityItem {
  company: string;
  companyId: string;
  org: string;
}

/** Every dated activity item across the watchlist, newest first. */
export function watchlistActivity(companies: CompanyWithIntel[]): CompanyActivity[] {
  return companies
    .flatMap((c) =>
      c.intelligence?.last_refreshed_at
        ? activityFrom(c.intelligence).map((a) => ({ ...a, company: c.name, companyId: c.id, org: c.github_org }))
        : [],
    )
    .filter((a) => a.date)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export const PULSE_SERIES = [
  { key: "news", label: "News & HN", color: SERIES[0], kinds: ["news", "hn"] },
  { key: "ship", label: "Releases & new repos", color: SERIES[1], kinds: ["release", "repo"] },
  { key: "blog", label: "Blog posts", color: SERIES[2], kinds: ["blog"] },
] as const;

export interface PulseWeek {
  start: Date;
  values: Record<(typeof PULSE_SERIES)[number]["key"], number>;
}

/** Weekly event counts for the last `weeks` weeks (oldest → newest). */
export function weeklyPulse(items: CompanyActivity[], weeks = 8, now = Date.now()): PulseWeek[] {
  const WEEK = 7 * 86_400_000;
  const end = now;
  const out: PulseWeek[] = Array.from({ length: weeks }, (_, i) => ({
    start: new Date(end - (weeks - i) * WEEK),
    values: { news: 0, ship: 0, blog: 0 },
  }));
  for (const item of items) {
    const t = new Date(item.date!).getTime();
    const idx = Math.floor((t - (end - weeks * WEEK)) / WEEK);
    if (idx < 0 || idx >= weeks) continue;
    const series = PULSE_SERIES.find((s) => (s.kinds as readonly string[]).includes(item.kind));
    if (series) out[idx].values[series.key]++;
  }
  return out;
}

/** Fixed groups → fixed colors (color follows the entity, never its rank or count). */
const STACK_GROUPS: { label: string; categories: InfraCategory[] }[] = [
  { label: "CI/CD", categories: ["CI/CD"] },
  { label: "Containers & K8s", categories: ["Container", "Orchestration"] },
  { label: "Cloud & hosting", categories: ["Cloud", "Hosting"] },
  { label: "Monorepo tooling", categories: ["Monorepo"] },
  { label: "IaC & observability", categories: ["IaC", "Observability"] },
];

/** Part-to-whole: share of confirmed infra signals across the watchlist, by group. */
export function stackMix(companies: CompanyWithIntel[]) {
  const slices = STACK_GROUPS.map((g, i) => ({
    label: g.label,
    color: SERIES[i],
    value: companies.reduce(
      (sum, c) => sum + (c.intelligence?.cloud_infra_tools ?? []).filter((t) => t.confirmed && g.categories.includes(t.category)).length,
      0,
    ),
  }));
  const total = slices.reduce((s, x) => s + x.value, 0);
  return { slices, total };
}
