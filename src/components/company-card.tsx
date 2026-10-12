"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  Briefcase,
  Check,
  ClipboardCopy,
  ChevronRight,
  Copy,
  ExternalLink,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ago, apiFetch, buildBrief, copyText, isStale, langColor, shortAgo, toastApiError } from "@/lib/client";
import type { Architecture, CompanyWithIntel, EngineeringIntelligence, HiringSignals, PitchTone, VelocityScore } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActivityList, activityFrom, highlightsFrom } from "./activity-feed";
import { HistoryPanel } from "./history-panel";

interface Props {
  company: CompanyWithIntel;
  refreshing: boolean;
  onRefresh: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onIntelUpdate: (id: string, intel: EngineeringIntelligence) => void;
}

const VELOCITY_STYLE: Record<VelocityScore, { dot: string; text: string; bg: string }> = {
  High: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  Moderate: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/10" },
  Low: { dot: "bg-zinc-400", text: "text-zinc-600 dark:text-zinc-400", bg: "bg-zinc-500/10" },
};

type ToneKey = "primary" | PitchTone;
const TONES: { key: ToneKey; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "technical", label: "Technical" },
  { key: "executive", label: "Executive" },
  { key: "casual", label: "Casual" },
];

export function CompanyCard({ company, refreshing, onRefresh, onRemove, onIntelUpdate }: Props) {
  const intel = company.intelligence;
  const hasData = Boolean(intel?.last_refreshed_at);
  const [removing, setRemoving] = useState(false);

  return (
    <Card className={cn("relative flex flex-col gap-0 py-0 transition-opacity", removing && "opacity-50")}>
      <CardHeader className="gap-2 border-b px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold leading-tight">{company.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <a
                href={`https://github.com/${company.github_org}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono hover:text-foreground"
              >
                <GitHubMark className="size-3" />@{company.github_org}
              </a>
              {company.domain && (
                <a
                  href={`https://${company.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 hover:text-foreground"
                >
                  {company.domain}
                  <ExternalLink className="size-2.5" />
                </a>
              )}
            </div>
          </div>
          {hasData && intel?.fit_score !== null && intel?.fit_score !== undefined && <FitBadge intel={intel} />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasData ? (
            <Badge
              variant="outline"
              className={cn("font-normal", isStale(intel!.last_refreshed_at) && "border-amber-500/50 text-amber-700 dark:text-amber-400")}
            >
              Refreshed {ago(intel!.last_refreshed_at)}
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Not enriched yet
            </Badge>
          )}
          {intel?.velocity_score && <VelocityTag velocity={intel.velocity_score} lastActivity={intel.last_commit_date} />}
          {intel && "microservices" in intel.architecture && <ArchitectureBadge arch={intel.architecture as Architecture} />}
          {intel?.ai_model === "heuristic-fallback" && (
            <Tooltip>
              <TooltipTrigger render={<Badge variant="secondary" className="cursor-help font-normal" />}>
                Template summary
              </TooltipTrigger>
              <TooltipContent className="max-w-60">
                Gemini was unavailable, so this summary was built from a deterministic template. Refresh once GEMINI_API_KEY is set.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 px-4 py-4">
        {refreshing && !hasData ? (
          <CardBodySkeleton />
        ) : !hasData ? (
          <NotEnriched error={intel?.refresh_error ?? null} onEnrich={() => onRefresh(company.id)} />
        ) : (
          <IntelBody company={company} intel={intel!} refreshing={refreshing} onIntelUpdate={onIntelUpdate} />
        )}
      </CardContent>

      <CardFooter className="gap-2 border-t px-4 py-3">
        <Button variant="outline" size="sm" onClick={() => onRefresh(company.id)} disabled={refreshing || removing}>
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {refreshing ? "Refreshing…" : "Refresh Intelligence"}
        </Button>
        {hasData && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy account brief"
                  onClick={() => copyText(buildBrief(company), "Account brief copied — paste into email or CRM")}
                />
              }
            >
              <ClipboardCopy />
            </TooltipTrigger>
            <TooltipContent>Copy full account brief</TooltipContent>
          </Tooltip>
        )}
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="ghost" size="sm" className="ml-auto text-muted-foreground hover:text-destructive" disabled={removing} />}
          >
            {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Remove
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {company.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the account, its cached intelligence and its refresh history. You can add it again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  setRemoving(true);
                  try {
                    await onRemove(company.id);
                  } finally {
                    setRemoving(false);
                  }
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}

function IntelBody({
  company,
  intel,
  refreshing,
  onIntelUpdate,
}: {
  company: CompanyWithIntel;
  intel: EngineeringIntelligence;
  refreshing: boolean;
  onIntelUpdate: Props["onIntelUpdate"];
}) {
  const paragraphs = (intel.engineering_summary ?? "").split(/\n\s*\n/).filter(Boolean);
  // Short TL;DR up front; the full two-paragraph context lives behind a dropdown.
  const overview = intel.overview ?? paragraphs[0]?.match(/^.*?[.!?](\s|$)/)?.[0] ?? "";
  const activity = activityFrom(intel);
  const matchingJobs = intel.hiring_signals?.matchingJobs ?? [];
  const confirmed = intel.cloud_infra_tools.filter((t) => t.confirmed);
  const mentioned = intel.cloud_infra_tools.filter((t) => !t.confirmed);

  return (
    <div className={cn("flex flex-col gap-4", refreshing && "pointer-events-none animate-pulse")}>
      {intel.refresh_error && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Last refresh failed: {intel.refresh_error} Showing previous data.
        </p>
      )}

      <p className="text-sm leading-relaxed">{overview}</p>

      {activity.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Building now</SectionLabel>
          <ActivityList items={highlightsFrom(activity)} />
        </section>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat icon={<GitCommitHorizontal className="size-3.5" />} value={intel.commits_30d ?? 0} label="commits / 30d" />
        <Stat value={intel.active_repo_count} label="active repos" />
        <Stat icon={<Star className="size-3.5" />} value={compact(intel.total_stars ?? 0)} label="stars (top 30)" />
      </div>

      <section className="space-y-2">
        <SectionLabel>Languages</SectionLabel>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {intel.dominant_languages.map((l) => (
            <div key={l.name} style={{ width: `${l.percentage}%`, background: langColor(l.name) }} title={`${l.name} ${l.percentage}%`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {intel.dominant_languages.slice(0, 6).map((l) => (
            <span key={l.name} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
              <span className="size-2 rounded-full" style={{ background: langColor(l.name) }} />
              {l.name}
              <span className="text-muted-foreground">{l.percentage}%</span>
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>Infrastructure</SectionLabel>
        {intel.cloud_infra_tools.length === 0 ? (
          <p className="text-xs text-muted-foreground">No infrastructure signals detected in public repos.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {[...confirmed, ...mentioned].map((t) => (
              <Tooltip key={t.name}>
                <TooltipTrigger
                  render={
                    <span
                      className={cn(
                        "inline-flex cursor-help items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                        t.confirmed
                          ? "bg-sky-500/10 text-sky-800 ring-1 ring-sky-500/20 dark:text-sky-300"
                          : "border border-dashed text-muted-foreground",
                      )}
                    />
                  }
                >
                  {t.confirmed && <Check className="size-3" />}
                  {t.name}
                </TooltipTrigger>
                <TooltipContent className="max-w-72">
                  <p className="font-medium">
                    {t.category} · {t.confirmed ? "confirmed in repo files" : "mentioned only"}
                  </p>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px] opacity-90">
                    {t.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </section>

      <HiringSection hiring={intel.hiring_signals} />

      <OutreachHook companyId={company.id} intel={intel} onIntelUpdate={onIntelUpdate} />

      <Accordion multiple defaultValue={[]} className="-mx-1">
        <AccordionItem value="context">
          <AccordionTrigger className="px-1 text-sm">Engineering context (full summary)</AccordionTrigger>
          <AccordionContent className="space-y-3 px-1 text-sm leading-relaxed text-muted-foreground">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <p className="text-[11px] text-muted-foreground/70">
              Generated by {intel.ai_model === "heuristic-fallback" ? "template fallback" : intel.ai_model} from public GitHub data.
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="fit">
          <AccordionTrigger className="px-1 text-sm">Why fit score {intel.fit_score}?</AccordionTrigger>
          <AccordionContent className="space-y-2 px-1">
            {intel.fit_reasons.map((r) => (
              <div key={r.label} className="space-y-1">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {r.points}/{r.max}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(r.points / r.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="activity">
          <AccordionTrigger className="px-1 text-sm">All recent activity ({activity.length})</AccordionTrigger>
          <AccordionContent className="px-1">
            <ActivityList items={activity} />
            <p className="mt-3 text-[11px] text-muted-foreground">
              Sources: Google News, Hacker News, GitHub releases &amp; new repos, company blog feed. Set{" "}
              <code className="font-mono">news_query</code> or <code className="font-mono">blog_feed_url</code> in Supabase to tune.
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="jobs">
          <AccordionTrigger className="px-1 text-sm">Matching job descriptions ({matchingJobs.length})</AccordionTrigger>
          <AccordionContent className="px-1">
            {matchingJobs.length ? (
              <ul className="space-y-2">
                {matchingJobs.map((j) => (
                  <li key={j.title} className="space-y-1">
                    {j.url ? (
                      <a href={j.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-medium hover:underline">
                        {j.title}
                        <ChevronRight className="size-3" />
                      </a>
                    ) : (
                      <span className="text-xs font-medium">{j.title}</span>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {j.tools.map((t) => (
                        <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          {t}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {intel.hiring_signals ? "No open engineering roles name specific tools right now." : "No public job board found."}
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="repos">
          <AccordionTrigger className="px-1 text-sm">Flagship repos</AccordionTrigger>
          <AccordionContent className="px-1">
            <ul className="divide-y text-sm">
              {intel.top_repos.map((r) => (
                <li key={r.name} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium hover:underline">
                      {r.name}
                    </a>
                    {r.description && <p className="line-clamp-1 text-xs text-muted-foreground">{r.description}</p>}
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    <div className="inline-flex items-center gap-0.5">
                      <Star className="size-3" />
                      {compact(r.stars)}
                    </div>
                    <div>pushed {shortAgo(r.pushed_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="history">
          <AccordionTrigger className="px-1 text-sm">Change history ({company.snapshots.length})</AccordionTrigger>
          <AccordionContent className="px-1">
            <HistoryPanel snapshots={company.snapshots} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function OutreachHook({
  companyId,
  intel,
  onIntelUpdate,
}: {
  companyId: string;
  intel: EngineeringIntelligence;
  onIntelUpdate: Props["onIntelUpdate"];
}) {
  const [tone, setTone] = useState<ToneKey>("primary");
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const text = tone === "primary" ? intel.outreach_pitch : intel.pitch_variants[tone];

  async function regenerate() {
    setRegenerating(true);
    const t: PitchTone = tone === "primary" ? "technical" : tone;
    try {
      const res = await apiFetch<{ intelligence: EngineeringIntelligence }>(`/api/pitch/${companyId}`, {
        method: "POST",
        body: JSON.stringify({ tone: t, makePrimary: tone === "primary" }),
      });
      onIntelUpdate(companyId, res.intelligence);
      toast.success("Fresh hook generated");
    } catch (err) {
      toastApiError(err, "Could not regenerate hook");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Outreach Hook</SectionLabel>
        <div role="tablist" aria-label="Pitch tone" className="flex rounded-md bg-muted p-0.5">
          {TONES.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tone === t.key}
              onClick={() => setTone(t.key)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                tone === t.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <blockquote className="relative rounded-lg border-l-4 border-primary bg-primary/5 py-2.5 pr-20 pl-3 text-sm leading-relaxed">
        {regenerating ? (
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-3/4" />
          </span>
        ) : (
          <span className="italic">{text ? `“${text}”` : "No variant yet — generate one."}</span>
        )}
        <span className="absolute top-1.5 right-1.5 flex gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" aria-label="Regenerate hook" onClick={regenerate} disabled={regenerating} />
              }
            >
              {regenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
            </TooltipTrigger>
            <TooltipContent>Regenerate with Gemini ({tone === "primary" ? "technical tone, set as primary" : tone})</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Copy to clipboard"
                  disabled={!text}
                  onClick={async () => {
                    if (text && (await copyText(text, "Outreach hook copied"))) {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }
                  }}
                />
              }
            >
              {copied ? <Check className="text-emerald-600" /> : <Copy />}
            </TooltipTrigger>
            <TooltipContent>Copy to Clipboard</TooltipContent>
          </Tooltip>
        </span>
      </blockquote>
      {tone === "primary" && intel.pitch_variants.angle && (
        <p className="text-[11px] text-muted-foreground">
          Built on their <span className="font-medium">{intel.pitch_variants.angle.replace(/-/g, " ")}</span> signal
        </p>
      )}
    </section>
  );
}

function ArchitectureBadge({ arch }: { arch: Architecture }) {
  const style =
    arch.microservices === "Likely"
      ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
      : arch.microservices === "Possible"
        ? "bg-violet-500/5 text-violet-700/80 dark:text-violet-300/80"
        : "bg-zinc-500/10 text-muted-foreground";
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", style)} />}>
        <Boxes className="size-3" />
        Microservices: {arch.microservices}
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        {arch.signals.length ? (
          <ul className="space-y-0.5 font-mono text-[11px]">
            {arch.signals.map((sig) => (
              <li key={sig}>{sig}</li>
            ))}
          </ul>
        ) : (
          "No structural evidence of independently deployed services in the scanned repos."
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function HiringSection({ hiring }: { hiring: HiringSignals | null }) {
  return (
    <section className="space-y-2">
      <SectionLabel>Hiring signals</SectionLabel>
      {!hiring ? (
        <p className="text-xs text-muted-foreground">
          No public Greenhouse, Lever, Ashby, Workable or Recruitee board found. Set <code className="font-mono">jobs_board</code> (e.g.{" "}
          <code className="font-mono">greenhouse:acme</code>) in Supabase to add one.
        </p>
      ) : (
        <div className="space-y-2">
          <a
            href={hiring.boardUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm hover:underline"
          >
            <Briefcase className="size-3.5 text-muted-foreground" />
            {hiring.totalRoles === 0 ? (
              <>Job board found, no open roles right now</>
            ) : (
              <>
                <span className="font-semibold tabular-nums">{hiring.engineeringRoles}</span> open engineering roles
              </>
            )}
            <span className="text-xs text-muted-foreground">
              of {hiring.totalRoles} · {hiring.provider}
            </span>
          </a>
          {hiring.tools.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hiring.tools.slice(0, 8).map((t) => (
                <span key={t.name} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
                  {t.name} <span className="text-muted-foreground">×{t.count}</span>
                </span>
              ))}
            </div>
          )}
          {hiring.sampleTitles.length > 0 && (
            <p className="line-clamp-2 text-[11px] text-muted-foreground">Hiring for: {hiring.sampleTitles.slice(0, 3).join(" · ")}</p>
          )}
        </div>
      )}
    </section>
  );
}

function VelocityTag({ velocity, lastActivity }: { velocity: VelocityScore; lastActivity: string | null }) {
  const s = VELOCITY_STYLE[velocity];
  const label = velocity === "Low" ? "Quiet" : "Active";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", s.bg, s.text)}>
      <span className="relative flex size-2">
        {velocity === "High" && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", s.dot)} />}
        <span className={cn("relative inline-flex size-2 rounded-full", s.dot)} />
      </span>
      {velocity} velocity · {label}: pushed {shortAgo(lastActivity)}
    </span>
  );
}

function FitBadge({ intel }: { intel: EngineeringIntelligence }) {
  const score = intel.fit_score ?? 0;
  const color = score >= 70 ? "text-emerald-600" : score >= 45 ? "text-amber-600" : "text-zinc-500";
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="relative size-11 shrink-0 cursor-help" aria-label={`Fit score ${score} out of 100`} />}>
        <svg viewBox="0 0 40 40" className="size-11 -rotate-90">
          <circle cx="20" cy="20" r={r} className="fill-none stroke-muted" strokeWidth="4" />
          <circle
            cx="20"
            cy="20"
            r={r}
            className={cn("fill-none stroke-current transition-all", color)}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * c} ${c}`}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-sm font-semibold tabular-nums">{score}</span>
          <span className="text-[8px] uppercase tracking-wide text-muted-foreground">fit</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        Fit score: how strongly this org shows the pain a developer-productivity tool solves (velocity, CI complexity,
        polyglot stack, monorepo, infra depth). Expand &ldquo;Why fit score&rdquo; for the breakdown.
      </TooltipContent>
    </Tooltip>
  );
}

function NotEnriched({ error, onEnrich }: { error: string | null; onEnrich: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-8 text-center">
      {error ? (
        <>
          <AlertTriangle className="size-6 text-amber-500" />
          <div className="max-w-xs space-y-1">
            <p className="text-sm font-medium">Enrichment failed</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </>
      ) : (
        <>
          <Sparkles className="size-6 text-muted-foreground" />
          <p className="max-w-xs text-sm text-muted-foreground">No intelligence yet. Scan this org&apos;s GitHub to generate its brief.</p>
        </>
      )}
      <Button size="sm" onClick={onEnrich}>
        <Sparkles /> {error ? "Retry enrichment" : "Enrich now"}
      </Button>
    </div>
  );
}

export function CardBodySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <Skeleton className="h-2 w-full" />
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-16 w-full" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

function Stat({ value, label, icon }: { value: number | string; label: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-1.5">
      <div className="flex items-center justify-center gap-1 text-base font-semibold tabular-nums">
        {icon}
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>;
}

const compact = (n: number) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
