"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ago } from "@/lib/client";
import { cn } from "@/lib/utils";

interface Health {
  supabase: { ok: boolean; detail?: string };
  github: { ok: boolean; authenticated: boolean; remaining: number | null; limit: number | null; resetAt: string | null };
  gemini: { configured: boolean; ok: boolean; model: string; detail?: string };
  cron: { configured: boolean };
}

/** Small integration status row so the AE (or a reviewer) can see what's wired up at a glance. */
export function StatusStrip() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (!health) return <div className="mt-4 h-5" />;

  const lowQuota = health.github.remaining !== null && health.github.limit !== null && health.github.remaining < health.github.limit * 0.1;
  const items = [
    { label: "Supabase", ok: health.supabase.ok, tip: health.supabase.ok ? "Connected" : health.supabase.detail ?? "Not connected" },
    {
      label: `GitHub ${health.github.remaining ?? "?"}/${health.github.limit ?? "?"}`,
      ok: health.github.ok && !lowQuota,
      warn: !health.github.authenticated || lowQuota,
      tip: `${health.github.authenticated ? "Authenticated with GITHUB_TOKEN" : "Unauthenticated (60 req/hr) — set GITHUB_TOKEN"}. Requests remaining this hour${
        health.github.resetAt ? `, resets ${ago(health.github.resetAt)}` : ""
      }.`,
    },
    {
      label: health.gemini.ok ? health.gemini.model : health.gemini.configured ? "Gemini key invalid" : "Gemini off",
      ok: health.gemini.ok,
      warn: !health.gemini.configured,
      tip: health.gemini.ok
        ? "Gemini Flash generates summaries and hooks"
        : `${health.gemini.detail ?? "Gemini unavailable"}. Using template summaries until fixed.`,
    },
    {
      label: `Next refresh ${nextWeeklyRun()}`,
      ok: health.cron.configured,
      warn: !health.cron.configured,
      tip: health.cron.configured
        ? "Vercel Cron re-researches every account older than 7 days each Sunday 00:00 UTC, and enriches newly added accounts daily at 06:00 UTC."
        : "CRON_SECRET not set — cron endpoint will reject calls",
    },
  ];

  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <Tooltip key={i.label}>
          <TooltipTrigger render={<span className="inline-flex cursor-help items-center gap-1.5" />}>
            <span className={cn("size-1.5 rounded-full", i.ok ? "bg-emerald-500" : i.warn ? "bg-amber-500" : "bg-rose-500")} />
            {i.label}
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{i.tip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/** Next Sunday 00:00 UTC (the weekly Vercel Cron in vercel.json), as a local day/time label. */
function nextWeeklyRun(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ((7 - now.getUTCDay()) % 7 || 7)));
  return next.toLocaleString("en", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
