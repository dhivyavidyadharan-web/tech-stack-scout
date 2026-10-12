"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Activity, Building2, ChevronDown, Download, Gauge, Loader2, Radar, RefreshCw, Search, Sparkles, TimerReset } from "lucide-react";
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
import type { CompanyWithIntel, EngineeringIntelligence, VelocityScore } from "@/lib/types";
import { AddCompanyDialog } from "./add-company-dialog";
import { CardBodySkeleton, CompanyCard } from "./company-card";
import { StatusStrip } from "./status-strip";
import { ThemeToggle } from "./theme-toggle";

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

export function Dashboard() {
  const [companies, setCompanies] = useState<CompanyWithIntel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState("all");
  const [velocity, setVelocity] = useState("all");
  const [arch, setArch] = useState("all");
  const [sort, setSort] = useState<SortKey>("fit");
  const cancelBulk = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ companies: CompanyWithIntel[] }>("/api/companies");
      setCompanies(res.companies);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load watchlist");
      setCompanies((c) => c ?? []);
    }
  }, []);

  useEffect(() => {
    // Initial fetch of the watchlist; setState happens after the network round-trip.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
    for (const [i, c] of targets.entries()) {
      if (cancelBulk.current) break;
      const keepGoing = await enrichOne(c.id, true);
      if (keepGoing) ok++;
      setBulk({ done: i + 1, total: targets.length });
      await load(); // stream results into the grid as each account completes
      if (!keepGoing) break;
    }
    setBulk(null);
    toast.success(`Refreshed ${ok} of ${targets.length} accounts`);
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
      { value: "all", label: "All cloud stacks" },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => ({ value: name, label: `${name} (${n})` })),
    ];
  }, [companies]);

  const visible = useMemo(() => {
    if (!companies) return [];
    const q = query.trim().toLowerCase();
    return companies
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.github_org.includes(q) || c.intelligence?.dominant_languages.some((l) => l.name.toLowerCase().includes(q)))
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
  }, [companies, query, stack, velocity, arch, sort]);

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

  const filtersActive = query || stack !== "all" || velocity !== "all" || arch !== "all";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Radar className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Tech Stack Scout</h1>
            <p className="text-sm text-muted-foreground">Live engineering intelligence for your target accounts</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" nativeButton={false} render={<a href="/api/export" download />} aria-disabled={!companies?.length}>
            <Download /> Export CSV
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
          <AddCompanyDialog
            existingOrgs={companies?.map((c) => c.github_org) ?? []}
            onAdded={() => void load()}
          />
        </div>
      </header>

      <StatusStrip />

      {bulk && (
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Scanning GitHub and generating briefs with Gemini Flash…</span>
            <span>
              {bulk.done} of {bulk.total}
            </span>
          </div>
          <Progress value={(bulk.done / bulk.total) * 100} />
        </div>
      )}

      {/* Metrics */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={<Building2 />} label="Total accounts" value={companies ? metrics.total : null} />
        <Metric icon={<Activity />} label="High-velocity accounts" value={companies ? metrics.high : null} accent="text-emerald-600" />
        <Metric icon={<Gauge />} label="Average fit score" value={companies ? (metrics.avgFit ?? "—") : null} />
        <Metric icon={<TimerReset />} label="Stale (> 7 days)" value={companies ? metrics.stale : null} accent={metrics.stale ? "text-amber-600" : undefined} />
      </section>

      {/* Not-yet-enriched banner */}
      {companies && metrics.unenriched > 0 && !bulk && (
        <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center">
          <p className="text-sm">
            <Sparkles className="mr-1.5 inline size-4 text-primary" />
            {metrics.unenriched} account{metrics.unenriched > 1 ? "s have" : " has"} no intelligence yet.
          </p>
          <Button size="sm" onClick={() => refreshMany("stale")}>
            Enrich {metrics.unenriched > 1 ? "them" : "it"} now
          </Button>
        </div>
      )}

      {/* Filters */}
      <section className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search company, handle or language" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterSelect items={stackOptions} value={stack} onChange={setStack} />
          <FilterSelect items={VELOCITIES} value={velocity} onChange={setVelocity} />
          <FilterSelect items={ARCHITECTURES} value={arch} onChange={setArch} />
          <FilterSelect items={SORTS} value={sort} onChange={(v) => setSort(v as SortKey)} />
          {filtersActive && (
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setStack("all");
                setVelocity("all");
                setArch("all");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </section>

      {/* Grid */}
      <main className="mt-4">
        {loadError && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Could not load the watchlist: {loadError}{" "}
            <button className="underline" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}
        {companies === null ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : companies.length === 0 ? (
          <EmptyState onAdded={() => void load()} />
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">No accounts match these filters.</div>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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
      </main>

      <footer className="mt-10 border-t pt-4 text-center text-xs text-muted-foreground">
        Data: GitHub REST API · public job boards (Greenhouse, Lever, Ashby) · engineering blog feeds · AI: Google Gemini Flash · Storage: Supabase · Auto-refresh weekly via Vercel Cron
      </footer>
    </div>
  );
}

function FilterSelect({
  items,
  value,
  onChange,
}: {
  items: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange((v as string | null) ?? "all")}>
      <SelectTrigger className="min-w-36">
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

function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number | string | null; accent?: string }) {
  return (
    <Card className="gap-0 py-3">
      <CardContent className="flex items-center gap-3 px-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">{icon}</div>
        <div>
          {value === null ? <Skeleton className="mb-1 h-6 w-10" /> : <div className={`text-2xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>}
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card className="gap-0 py-0">
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
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-20 text-center">
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
