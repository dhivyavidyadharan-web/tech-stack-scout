"use client";

import { useEffect, useState } from "react";
import { Activity, BarChart3, Building2, Download, LayoutDashboard, Radio, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "pulse", label: "Market pulse", icon: BarChart3 },
  { id: "feed", label: "Live feed", icon: Radio },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "accounts", label: "Accounts", icon: Building2 },
] as const;

/**
 * Highlights the section under the reading line (30% down the viewport).
 * Feed and leaderboard sit side by side, so when both qualify the one named
 * in the URL hash wins. Scroll-position based: cheap for 5 sections and works
 * even where IntersectionObserver is throttled.
 */
function useActiveSection(): string {
  const [active, setActive] = useState<string>(NAV[0].id);

  useEffect(() => {
    const pick = () => {
      const line = window.innerHeight * 0.3;
      const under = NAV.map((n) => document.getElementById(n.id))
        .filter((el): el is HTMLElement => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.top <= line && r.bottom > line;
        })
        .map((el) => el.id);
      const hash = window.location.hash.slice(1);
      const next = under.includes(hash) ? hash : under[0];
      // Above the first section (top of page) → Overview.
      setActive(next ?? (window.scrollY < 200 ? NAV[0].id : (prev) => prev));
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("hashchange", pick);
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("hashchange", pick);
      window.removeEventListener("resize", pick);
    };
  }, []);
  return active;
}

export function DoraMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.82_0.1_355)] to-[oklch(0.62_0.16_355)] text-white shadow-soft">
        <Activity className="size-4.5" strokeWidth={2.4} />
        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card bg-emerald-brand" />
      </div>
      <div className="leading-none">
        <div className="font-display text-2xl font-semibold tracking-tight italic">Dora</div>
        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Tech Stack Scout</div>
      </div>
    </div>
  );
}

export function Sidebar({ counts }: { counts: Partial<Record<(typeof NAV)[number]["id"], number>> }) {
  const active = useActiveSection();
  return (
    <aside className="glass sticky top-0 z-20 hidden h-screen w-60 shrink-0 flex-col border-r lg:flex">
      <div className="bg-gradient-to-br from-[oklch(0.86_0.08_355)] via-[oklch(0.8_0.1_355)] to-[oklch(0.72_0.1_165)] px-5 py-5 text-[oklch(0.25_0.05_345)] dark:from-[oklch(0.45_0.12_355)] dark:via-[oklch(0.4_0.1_355)] dark:to-[oklch(0.38_0.08_165)] dark:text-white">
        <DoraMark />
      </div>
      <nav aria-label="Dashboard sections" className="flex-1 space-y-1 px-3 py-4">
        {NAV.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active === id ? "true" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              active === id && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className={cn("size-4 transition-colors", active === id ? "text-primary" : "group-hover:text-primary")} />
            <span className="flex-1">{label}</span>
            {counts[id] !== undefined && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{counts[id]}</span>
            )}
          </a>
        ))}
      </nav>
      <div className="space-y-3 border-t px-5 py-4 text-xs text-muted-foreground">
        <a href="/api/export" download className="flex items-center gap-2 font-medium hover:text-foreground">
          <Download className="size-3.5" /> Export watchlist (CSV)
        </a>
        <p className="leading-relaxed">
          GitHub · job boards · Google News · Hacker News · blogs, summarised by Gemini Flash.
        </p>
      </div>
    </aside>
  );
}
