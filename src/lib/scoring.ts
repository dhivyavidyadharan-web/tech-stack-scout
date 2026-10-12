import type { FitReason, RawStats, VelocityScore } from "./types";

/**
 * Build velocity from commit and push recency.
 * - High:     ≥150 commits in 30d across the busiest repos, or ≥8 repos pushed this week
 * - Moderate: ≥20 commits in 30d, or ≥3 repos pushed this month
 * - Low:      anything quieter
 */
export function velocityFrom(stats: Pick<RawStats, "commits30d" | "pushedLast7d" | "activeRepos30d">): VelocityScore {
  if (stats.commits30d >= 150 || stats.pushedLast7d >= 8) return "High";
  if (stats.commits30d >= 20 || stats.activeRepos30d >= 3) return "Moderate";
  return "Low";
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));

/**
 * "Fit Score" (0–100): how likely this engineering org feels the pain a
 * developer-productivity tool solves. Transparent and explainable — every
 * point maps to a reason the AE can repeat on a call. Weights total 100.
 */
export function fitScore(stats: RawStats): { score: number; reasons: FitReason[] } {
  const significantLangs = stats.languages.filter((l) => l.percentage >= 5).length;
  const hasMonorepo = stats.infra.some((t) => t.category === "Monorepo" && t.confirmed);
  const infraDepth = stats.infra.filter(
    (t) => t.confirmed && ["Container", "Orchestration", "IaC", "Cloud"].includes(t.category),
  ).length;

  const ms = stats.architecture.microservices;
  const hiring = stats.hiring;

  const reasons: FitReason[] = [
    { label: `Commit throughput: ${stats.commits30d} commits in the last 30 days`, points: clamp((stats.commits30d / 400) * 20, 20), max: 20 },
    { label: `Surface area: ${stats.activeRepos30d} repos pushed in the last 30 days`, points: clamp(stats.activeRepos30d * 1.5, 15), max: 15 },
    { label: `CI/CD complexity: ${stats.workflowFileCount} workflow files in top repos`, points: clamp((stats.workflowFileCount / 20) * 15, 15), max: 15 },
    {
      label: `Microservices: ${ms.toLowerCase()}${stats.architecture.signals[0] ? ` (${stats.architecture.signals[0]})` : ""}`,
      points: ms === "Likely" ? 10 : ms === "Possible" ? 5 : 0,
      max: 10,
    },
    {
      label: hiring ? `Hiring: ${hiring.engineeringRoles} open engineering roles` : "Hiring: no public job board found",
      points: hiring ? clamp(hiring.engineeringRoles, 10) : 0,
      max: 10,
    },
    { label: `Polyglot stack: ${significantLangs} languages above 5% of code`, points: clamp((significantLangs - 1) * 4, 10), max: 10 },
    { label: hasMonorepo ? "Monorepo tooling detected (builds get slow at scale)" : "No monorepo tooling detected", points: hasMonorepo ? 10 : 0, max: 10 },
    { label: `Infra depth: ${infraDepth} confirmed container/cloud/IaC tools`, points: clamp(infraDepth * 2.5, 10), max: 10 },
  ];

  return { score: reasons.reduce((s, r) => s + r.points, 0), reasons };
}
