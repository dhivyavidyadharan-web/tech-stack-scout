"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, Loader2, Radar, RefreshCw, RotateCw, Search, Sparkles, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError, apiFetch, isStale, toastApiError } from "@/lib/client";
import { sinceLabel, useNow } from "@/lib/live";
import type { CompanyWithIntel, EngineeringIntelligence, VelocityScore } from "@/lib/types";
import { cn } from "@/lib/utils";
import { stackMix, watchlistActivity, weeklyPulse } from "@/lib/viz";
import { AddCompanyDialog } from "./add-company-dialog";
import { ActivityPulse } from "./charts/activity-pulse";
import { StackMix } from "./charts/stack-mix";
import { CardBodySkeleton, CompanyCard } from "./company-card";
import { Leaderboard } from "./leaderboard";
import { LiveFeed } from "./live-feed";
import { DoraMark, Sidebar } from "./sidebar";
import { StatTiles, type TileSpec } from "./stat-tiles";
import { StatusStrip } from "./status-strip";
import { ThemeToggle } from "./theme-toggle";
import { Ticker } from "./ticker";

const SYNC_INTERVAL_MS = 60_000;

type SortKey = "fit" | "velocity" | "recent" | "name";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "fit", label: "Sort: Fit score" },
  { value: "velocity", label: "Sort: Velocity" },
  { value: "recent", label: "Sort: Last push" },
  { value: "name", label: "Sort: Name" },
];
const VELOCITIES = [
  { value: "all", label: "All velocities" },
  { value: "High", label: "High velocity" },
  { value: "Moderate", label: "Moderate velocity" },
  { value: "Low", label: "Low velocity" },
];
const ARCHITECTURES = [
  { value: "all", label: "Any architecture" },
  { value: "Likely", label: "Microservices: likely" },
  { value: "Possible", label: "Microservices: possible" },
  { value: "hiring", label: "Hiring engineers" },
];
const STACK_CATEGORIES = new Set(["Cloud", "Orchestration", "Container", "IaC", "Hosting"]);
const VELOCITY_RANK: Record<VelocityScore, number> = { High: 2, Moderate: 1, Low: 0 };

export function Dashboard({ initialCompanies }: { initialCompanies: CompanyWithIntel[] | null }) {
  const [companies, setCompanies] = useState<CompanyWithIntel[] | null>(initialCompanies);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState("all");
  const [language, setLanguage] = useState("all");
  const [velocity, setVelocity] = useState("all");
  const [arch, setArch] = useState("all");
  const [sort, setSort] = useState<SortKey>("fit");
  const cancelBulk = useRef(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Coarse clock for time-window maths (weekly pulse, "this week") — keeps render pure.
  const minute = useNow(60_000);

  const load = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await apiFetch<{ companies: CompanyWithIntel[] }>("/api/companies");
      setCompanies(res.companies);
      setLoadError(null);
      setLastSync(Date.now());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load watchlist");
      setCompanies((c) => c ?? []);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    // Server-rendered data is already fresh: just stamp the sync time. Otherwise fetch now.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialCompanies) setLastSync(Date.now());
    else void load();
  }, [load, initialCompanies]);

  // Live: quietly re-sync while the tab is visible, so cron refreshes and teammates' changes appear.
  const bulkRunning = bulk !== null;
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !bulkRunning) void load();
    }, SYNC_INTERVAL_MS);
    // Coming back to the tab: catch up immediately instead of waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !bulkRunning) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, bulkRunning]);

  const setBusy = (id: string, busy: boolean) =>
    setRefreshing((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Returns false if the run should stop (rate limited). */
  const enrichOne = useCallback(async (id: string, quiet = false): Promise<boolean> => {
    setBusy(id, true);
    try {
      await apiFetch(`/api/enrich/${id}`, { method: "POST" });
      if (!quiet) toast.success("Intelligence refreshed");
      return true;
    } catch (err) {
      toastApiError(err, "Refresh failed");
      return !(err instanceof ApiClientError && err.code === "GITHUB_RATE_LIMIT");
    } finally {
      setBusy(id, false);
    }
  }, []);

  const refreshOne = useCallback(
    async (id: string) => {
      await enrichOne(id);
      await load();
    },
    [enrichOne, load],
  );

  async function refreshMany(mode: "stale" | "all") {
    if (!companies) return;
    const targets = companies.filter((c) => mode === "all" || isStale(c.intelligence?.last_refreshed_at));
    if (targets.length === 0) {
      toast.info("Everything is fresh", { description: "All accounts were refreshed within the last 7 days." });
      return;
    }
    cancelBulk.current = false;
    setBulk({ done: 0, total: targets.length });
    let ok = 0;
    let stopped = false;
    for (const [i, c] of targets.entries()) {
      if (cancelBulk.current) {
        stopped = true;
        break;
      }
      const keepGoing = await enrichOne(c.id, true);
      if (keepGoing) ok++;
      setBulk({ done: i + 1, total: targets.length });
      await load(); // stream results into the grid as each account completes
      if (!keepGoing) break;
    }
    setBulk(null);
    const noun = targets.length === 1 ? "account" : "accounts";
    if (stopped) toast.info(`Stopped — refreshed ${ok} of ${targets.length} ${noun}`);
    else toast.success(`Refreshed ${ok} of ${targets.length} ${noun}`);
  }

  const remove = useCallback(async (id: string) => {
    try {
      const res = await apiFetch<{ name: string }>(`/api/companies/${id}`, { method: "DELETE" });
      setCompanies((list) => list?.filter((c) => c.id !== id) ?? null);
      toast.success(`${res.name} removed from watchlist`);
    } catch (err) {
      toastApiError(err, "Could not remove company");
    }
  }, []);

  const updateIntel = useCallback((id: string, intel: EngineeringIntelligence) => {
    setCompanies((list) => list?.map((c) => (c.id === id ? { ...c, intelligence: intel } : c)) ?? null);
  }, []);

  const stackOptions = useMemo(() => {
    const counts = new Map<string, number>();
    companies?.forEach((c) =>
      c.intelligence?.cloud_infra_tools
        .filter((t) => t.confirmed && STACK_CATEGORIES.has(t.category))
        .forEach((t) => counts.set(t.name, (counts.get(t.name) ?? 0) + 1)),
    );
    return [
      { value: "all", label: "All cloud & services" },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => ({ value: name, label: `${name} (${n})` })),
    ];
  }, [companies]);

  // Languages that make up at least 5% of some account's code, most common first.
  const languageOptions = useMemo(() => {
    const counts = new Map<string, number>();
    companies?.forEach((c) =>
      c.intelligence?.dominant_languages
        .filter((l) => l.percentage >= 5)
        .forEach((l) => counts.set(l.name, (counts.get(l.name) ?? 0) + 1)),
    );
    return [
      { value: "all", label: "All languages" },
      ...[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ value: name, label: `${name} (${n})` })),
    ];
  }, [companies]);

  const visible = useMemo(() => {
    if (!companies) return [];
    const q = query.trim().toLowerCase();
    return companies
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.github_org.includes(q) ||
          c.intelligence?.dominant_languages.some((l) => l.name.toLowerCase().includes(q)) ||
          c.intelligence?.cloud_infra_tools.some((t) => t.name.toLowerCase().includes(q)),
      )
      .filter((c) => language === "all" || c.intelligence?.dominant_languages.some((l) => l.name === language && l.percentage >= 5))
      .filter((c) => stack === "all" || c.intelligence?.cloud_infra_tools.some((t) => t.confirmed && t.name === stack))
      .filter((c) => velocity === "all" || c.intelligence?.velocity_score === velocity)
      .filter((c) => {
        if (arch === "all") return true;
        if (arch === "hiring") return (c.intelligence?.hiring_signals?.engineeringRoles ?? 0) > 0;
        const a = c.intelligence?.architecture;
        return Boolean(a && "microservices" in a && a.microservices === arch);
      })
      .sort((a, b) => {
        const ia = a.intelligence;
        const ib = b.intelligence;
        switch (sort) {
          case "fit":
            return (ib?.fit_score ?? -1) - (ia?.fit_score ?? -1);
          case "velocity":
            return (ib?.velocity_score ? VELOCITY_RANK[ib.velocity_score] : -1) - (ia?.velocity_score ? VELOCITY_RANK[ia.velocity_score] : -1) || (ib?.commits_30d ?? 0) - (ia?.commits_30d ?? 0);
          case "recent":
            return (ib?.last_commit_date ?? "").localeCompare(ia?.last_commit_date ?? "");
          default:
            return a.name.localeCompare(b.name);
        }
      });
  }, [companies, query, stack, language, velocity, arch, sort]);

  const metrics = useMemo(() => {
    const list = companies ?? [];
    const scored = list.filter((c) => c.intelligence?.fit_score != null);
    return {
      total: list.length,
      high: list.filter((c) => c.intelligence?.velocity_score === "High").length,
      avgFit: scored.length ? Math.round(scored.reduce((s, c) => s + (c.intelligence!.fit_score ?? 0), 0) / scored.length) : null,
      stale: list.filter((c) => isStale(c.intelligence?.last_refreshed_at)).length,
      unenriched: list.filter((c) => !c.intelligence?.last_refreshed_at).length,
    };
  }, [companies]);

  const filtersActive = query || stack !== "all" || language !== "all" || velocity !== "all" || arch !== "all";

  const clearFilters = () => {
    setQuery("");
    setStack("all");
    setLanguage("all");
    setVelocity("all");
    setArch("all");
  };

  /** Scroll to an account card (clearing filters if they hide it) and flash it. */
  const jumpTo = (id: string) => {
    if (!visible.some((c) => c.id === id)) clearFilters();
    requestAnimationFrame(() =>
      setTimeout(() => {
        const el = document.getElementById(`card-${id}`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.remove("flash");
        void el.offsetWidth; // restart the animation
        el.classList.add("flash");
      }, 50),
    );
  };

  const activity = useMemo(() => watchlistActivity(companies ?? []), [companies]);
  // Variety over volume: at most 2 items per company per kind (frequent releases would flood it).
  const feedItems = useMemo(() => {
    const seen = new Map<string, number>();
    return activity
      .filter((a) => {
        const k = `${a.companyId}:${a.kind}`;
        const n = seen.get(k) ?? 0;
        seen.set(k, n + 1);
        return n < 2;
      })
      .slice(0, 14);
  }, [activity]);
  const pulse = useMemo(() => weeklyPulse(activity, 8, minute), [activity, minute]);
  const mix = useMemo(() => stackMix(companies ?? []), [companies]);

  const tiles = useMemo<TileSpec[]>(() => {
    const list = (companies ?? []).filter((c) => c.intelligence?.last_refreshed_at);
    const loaded = companies !== null;
    const hiring = list.filter((c) => (c.intelligence!.hiring_signals?.engineeringRoles ?? 0) > 0);
    const commits = list.reduce((s, c) => s + (c.intelligence!.commits_30d ?? 0), 0);
    const best = [...list].sort((a, b) => (b.intelligence!.fit_score ?? 0) - (a.intelligence!.fit_score ?? 0))[0];
    const DAY = 86_400_000;
    const week = activity.filter((a) => minute - new Date(a.date!).getTime() < 7 * DAY);
    const perDay = Array.from({ length: 7 }, (_, i) => {
      const dayStart = minute - (7 - i) * DAY;
      return {
        label: new Date(dayStart + DAY).toLocaleDateString("en", { weekday: "short" }),
        value: week.filter((a) => {
          const t = new Date(a.date!).getTime();
          return t >= dayStart && t < dayStart + DAY;
        }).length,
      };
    });
    return [
      {
        key: "accounts",
        icon: "accounts",
        label: "Accounts tracked",
        value: loaded ? metrics.total : null,
        sub: `${hiring.length} ${hiring.length === 1 ? "account is" : "accounts are"} hiring engineers`,
        bars: list.map((c) => ({ label: c.name, value: c.intelligence!.hiring_signals?.engineeringRoles ?? 0 })),
        gradient: "bg-gradient-to-br from-[oklch(0.72_0.14_355)] to-[oklch(0.56_0.17_350)]",
      },
      {
        key: "velocity",
        icon: "velocity",
        label: "High velocity",
        value: loaded ? metrics.high : null,
        sub: `${commits.toLocaleString()} public commits in 30 days`,
        bars: list.map((c) => ({ label: c.name, value: c.intelligence!.commits_30d ?? 0 })),
        gradient: "bg-gradient-to-br from-[oklch(0.66_0.12_165)] to-[oklch(0.46_0.1_170)]",
      },
      {
        key: "fit",
        icon: "fit",
        label: "Average fit",
        value: loaded ? (metrics.avgFit ?? 0) : null,
        sub: best ? `Top: ${best.name} (${best.intelligence!.fit_score})` : "No scores yet",
        bars: list.map((c) => ({ label: c.name, value: c.intelligence!.fit_score ?? 0 })),
        gradient: "bg-gradient-to-br from-[oklch(0.7_0.12_118)] to-[oklch(0.5_0.1_130)]",
      },
      {
        key: "signals",
        icon: "signals",
        label: "Signals this week",
        value: loaded && minute ? week.length : null,
        sub: "News, releases & posts · last 7 days",
        bars: minute ? perDay : [],
        gradient: "bg-gradient-to-br from-[oklch(0.7_0.14_355)] to-[oklch(0.5_0.1_165)]",
      },
    ];
  }, [companies, activity, metrics, minute]);

  return (
    <div className="relative z-10 flex min-h-screen w-full">
      <Sidebar
        counts={{
          leaderboard: companies?.filter((c) => c.intelligence?.last_refreshed_at).length,
          accounts: companies?.length,
        }}
      />

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="glass sticky top-0 z-30 border-b">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <DoraMark className="lg:hidden" />
              <div className="hidden lg:block">
                <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome back, Nikhil</h1>
                <p className="text-xs text-muted-foreground">Here&apos;s what your accounts are building right now.</p>
              </div>
              <SyncIndicator lastSync={lastSync} syncing={syncing} hasData={companies !== null} onSync={() => void load()} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle />
              <Button variant="outline" nativeButton={false} render={<a href="/api/export" download />} aria-disabled={!companies?.length}>
                <Download /> <span className="hidden sm:inline">Export CSV</span>
              </Button>
              {bulk ? (
                <Button variant="outline" onClick={() => (cancelBulk.current = true)}>
                  <Loader2 className="animate-spin" /> {bulk.done}/{bulk.total} · Stop
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" disabled={!companies?.length} />}>
                    <RefreshCw /> Refresh <ChevronDown className="opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => refreshMany("stale")}>
                      <TimerReset /> Refresh stale ({metrics.stale})
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => refreshMany("all")}>
                      <RefreshCw /> Refresh all ({metrics.total})
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <AddCompanyDialog existingOrgs={companies?.map((c) => c.github_org) ?? []} onAdded={() => void load()} />
            </div>
          </div>
          {bulk && (
            <div className="space-y-1 px-4 pb-3 sm:px-6 lg:px-8">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Scanning GitHub, job boards & news, then briefing with Gemini Flash…</span>
                <span>
                  {bulk.done} of {bulk.total}
                </span>
              </div>
              <Progress value={(bulk.done / bulk.total) * 100} />
            </div>
          )}
        </header>

        <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {/* Overview */}
          <section id="overview" className="scroll-mt-24 space-y-4">
            <StatusStrip />
            <StatTiles tiles={tiles} />
            <Ticker items={activity} />
            {companies && metrics.unenriched > 0 && !bulk && (
              <div className="glass flex flex-col items-start justify-between gap-3 rounded-2xl border border-primary/25 px-4 py-3 shadow-soft sm:flex-row sm:items-center">
                <p className="text-sm">
                  <Sparkles className="mr-1.5 inline size-4 text-primary" />
                  {metrics.unenriched} account{metrics.unenriched > 1 ? "s have" : " has"} no intelligence yet.
                </p>
                <Button size="sm" onClick={() => refreshMany("stale")}>
                  Enrich {metrics.unenriched > 1 ? "them" : "it"} now
                </Button>
              </div>
            )}
          </section>

          {/* Pulse + mix */}
          <section id="pulse" className="grid scroll-mt-24 gap-6 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Market pulse"
              subtitle="What your watchlist shipped and said, week by week"
            >
              {/* Time-windowed: drawn once the client clock is running (keeps SSR + hydration identical). */}
              {companies === null || !minute ? <Skeleton className="h-56 w-full rounded-xl" /> : <ActivityPulse weeks={pulse} />}
            </Panel>
            <Panel title="Stack mix" subtitle="Confirmed infrastructure signals across accounts">
              {companies === null ? <Skeleton className="mx-auto size-44 rounded-full" /> : <StackMix {...mix} />}
            </Panel>
          </section>

          {/* Feed + leaderboard */}
          <div className="grid gap-6 lg:grid-cols-5">
            <Panel
              id="feed"
              className="scroll-mt-24 lg:col-span-2"
              title="Live feed"
              subtitle="Across every account, newest first"
              action={
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-brand">
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-brand motion-reduce:animate-none" /> auto-updating
                </span>
              }
            >
              {companies === null ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto pr-1">
                  <LiveFeed items={feedItems} onJump={jumpTo} />
                </div>
              )}
            </Panel>
            <Panel id="leaderboard" className="scroll-mt-24 lg:col-span-3" title="Leaderboard" subtitle="Ranked by fit hypothesis — click a row to open the account">
              {companies === null ? <Skeleton className="h-56 w-full rounded-xl" /> : <Leaderboard companies={companies} onJump={jumpTo} />}
            </Panel>
          </div>

          {/* Accounts */}
          <section id="accounts" className="scroll-mt-24 space-y-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-2xl font-semibold tracking-tight">Accounts</h2>
              <p className="text-sm text-muted-foreground">Filter by language, cloud & services, velocity or architecture.</p>
            </div>
            <div className="glass flex flex-col gap-2 rounded-2xl border p-3 shadow-soft sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search company, language or tool" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterSelect label="Filter by language" items={languageOptions} value={language} onChange={setLanguage} />
                <FilterSelect label="Filter by cloud and services" items={stackOptions} value={stack} onChange={setStack} />
                <FilterSelect label="Filter by velocity" items={VELOCITIES} value={velocity} onChange={setVelocity} />
                <FilterSelect label="Filter by architecture or hiring" items={ARCHITECTURES} value={arch} onChange={setArch} />
                <FilterSelect label="Sort accounts" items={SORTS} value={sort} onChange={(v) => setSort(v as SortKey)} />
                {filtersActive && (
                  <Button variant="ghost" onClick={clearFilters}>
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {loadError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Could not load the watchlist: {loadError}{" "}
                <button className="underline" onClick={() => void load()}>
                  Retry
                </button>
              </div>
            )}
            {companies === null ? (
              <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : companies.length === 0 ? (
              <EmptyState onAdded={() => void load()} />
            ) : visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-16 text-center text-sm text-muted-foreground">No accounts match these filters.</div>
            ) : (
              <div className="grid items-start gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {visible.map((c) => (
                  <CompanyCard
                    key={c.id}
                    company={c}
                    refreshing={refreshing.has(c.id)}
                    onRefresh={refreshOne}
                    onRemove={remove}
                    onIntelUpdate={updateIntel}
                  />
                ))}
              </div>
            )}
          </section>

          <footer className="border-t pt-4 pb-2 text-center text-xs text-muted-foreground">
            <span className="font-display italic">Dora</span> · Tech Stack Scout — GitHub · job boards · Google News · Hacker News · company blogs ·
            Gemini Flash · Supabase · weekly Vercel Cron
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Owns the 1s clock so only this badge re-renders every second, not the whole dashboard. */
function SyncIndicator({
  lastSync,
  syncing,
  hasData,
  onSync,
}: {
  lastSync: number | null;
  syncing: boolean;
  hasData: boolean;
  onSync: () => void;
}) {
  const now = useNow(1000);
  // Server-rendered data is fresh at request time, before the client clock starts.
  const label = syncing ? "syncing…" : lastSync && now ? `synced ${sinceLabel(lastSync, now)}` : hasData ? "synced just now" : "connecting…";
  return (
    <button
      onClick={onSync}
      className="group flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      aria-label="Sync now"
      title="Sync now"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-brand opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-brand" />
      </span>
      <span className="font-semibold text-foreground">Live</span>
      <span className="whitespace-nowrap tabular-nums">{label}</span>
      <RotateCw className={cn("size-3 opacity-60 group-hover:opacity-100", syncing && "animate-spin")} />
    </button>
  );
}

function Panel({
  id,
  title,
  subtitle,
  action,
  className,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("rounded-2xl border bg-card p-5 shadow-soft", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange((v as string | null) ?? "all")}>
      <SelectTrigger className="min-w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SkeletonCard() {
  return (
    <Card className="gap-0 rounded-2xl py-0 shadow-soft">
      <CardHeader className="gap-2 border-b px-4 py-3.5">
        <div className="flex justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="size-11 rounded-full" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-5 w-40 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="px-4 py-4">
        <CardBodySkeleton />
      </CardContent>
      <CardFooter className="border-t px-4 py-3">
        <Skeleton className="h-7 w-40" />
      </CardFooter>
    </Card>
  );
}

function EmptyState({ onAdded }: { onAdded: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Radar className="size-7 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">No companies added yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Add a target account by its GitHub organization. We&apos;ll scan its public repos and give you its languages,
          infrastructure, build velocity, an engineering summary and a tailored opening line.
        </p>
      </div>
      <AddCompanyDialog existingOrgs={[]} onAdded={onAdded} />
    </div>
  );
}
