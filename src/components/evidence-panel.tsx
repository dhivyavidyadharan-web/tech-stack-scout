"use client";

import { ExternalLink, FileCode2, Briefcase, Package, Tag } from "lucide-react";
import { format } from "date-fns";
import type { CompanyWithIntel, EngineeringIntelligence, EvidenceSource } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND: Record<EvidenceSource["kind"], { label: string; icon: typeof FileCode2; tone: string }> = {
  file: { label: "In public code", icon: FileCode2, tone: "text-emerald-700 dark:text-emerald-300" },
  manifest: { label: "In dependencies", icon: Package, tone: "text-emerald-700 dark:text-emerald-300" },
  job: { label: "In job posts", icon: Briefcase, tone: "text-sky-700 dark:text-sky-300" },
  mention: { label: "Mentioned only", icon: Tag, tone: "text-muted-foreground" },
};

/** Per-source status chips: which live sources contributed to this account's intelligence. */
export function SourceStatus({ intel }: { intel: EngineeringIntelligence }) {
  const news = (intel.news ?? []).filter((n) => n.kind === "news").length;
  const hn = (intel.news ?? []).filter((n) => n.kind === "hn").length;
  const items = [
    { label: "GitHub", ok: true },
    { label: intel.hiring_signals ? `Jobs · ${intel.hiring_signals.provider}` : "Jobs", ok: Boolean(intel.hiring_signals) },
    { label: "Blog", ok: (intel.blog_posts?.length ?? 0) > 0 },
    { label: `News ${news}`, ok: news > 0 },
    { label: `HN ${hn}`, ok: hn > 0 },
    { label: intel.ai_model === "heuristic-fallback" ? "Template" : "Gemini", ok: intel.ai_model !== "heuristic-fallback" },
  ];
  return (
    <div className="flex flex-wrap gap-1" aria-label="Sources used in the last refresh">
      {items.map((i) => (
        <span
          key={i.label}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px]",
            i.ok ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
          )}
        >
          <span aria-hidden>{i.ok ? "✓" : "–"}</span>
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Every claim on the card, with its proof: the exact repo file, manifest, job
 * board or repo it came from, how strong that evidence is, and when it was observed.
 */
export function EvidencePanel({ company, intel }: { company: CompanyWithIntel; intel: EngineeringIntelligence }) {
  const observed = intel.last_refreshed_at ? format(new Date(intel.last_refreshed_at), "d MMM yyyy, HH:mm") : "—";
  const org = company.github_org;
  const analyzed = "reposAnalyzed" in intel.raw_stats ? intel.raw_stats.reposAnalyzed : null;

  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">
        Observed <span suppressHydrationWarning>{observed}</span> from live public sources. <b>In public code</b> /{" "}
        <b>In dependencies</b> means a public repo references the tool; <b>In job posts</b> means they hire for it;{" "}
        <b>Mentioned only</b> is a weak signal and never counted. Current production use is not verified — phrase
        outreach as &ldquo;I noticed…&rdquo;, not as fact about their infrastructure.
      </p>

      <ul className="space-y-1.5">
        <SourceRow
          claim={`Languages: ${intel.dominant_languages.slice(0, 3).map((l) => `${l.name} ${l.percentage}%`).join(", ")}`}
          how={`GitHub languages API · byte counts across ${analyzed ?? "the most active"} repos (docs & examples excluded)`}
          url={`https://github.com/${org}?tab=repositories`}
          strength="Measured"
        />
        <SourceRow
          claim={`Public velocity: ${intel.velocity_score ?? "—"} · ${intel.commits_30d ?? 0} commits in 30 days`}
          how="GitHub commits API on the busiest public repos · push recency of the 30 latest (private repos not visible)"
          url={`https://github.com/${org}?tab=repositories`}
          strength="Measured"
        />
      </ul>

      <div className="space-y-2">
        {intel.cloud_infra_tools.map((t) => (
          <div key={t.name} className="rounded-lg border p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold">{t.name}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] font-medium",
                  t.confirmed ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground",
                )}
              >
                {t.confirmed ? "Detected" : "Weak signal"} · {t.category}
              </span>
            </div>
            {t.sources?.length ? (
              <ul className="space-y-0.5">
                {t.sources.map((s) => {
                  const k = KIND[s.kind];
                  const Icon = k.icon;
                  return (
                    <li key={s.url + s.label} className="flex items-center gap-1.5">
                      <Icon className={cn("size-3 shrink-0", k.tone)} aria-hidden />
                      <span className={cn("shrink-0 text-[10px]", k.tone)}>{k.label}</span>
                      <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-[11px] hover:underline">
                        {s.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              // Rows refreshed before evidence links existed fall back to the plain-text proof.
              <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                {t.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceRow({ claim, how, url, strength }: { claim: string; how: string; url: string; strength: string }) {
  return (
    <li className="rounded-lg border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{claim}</span>
        <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
          {strength}
        </span>
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
        {how}
        <ExternalLink className="size-2.5" />
      </a>
    </li>
  );
}
