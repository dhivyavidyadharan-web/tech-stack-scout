import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { enrichCompany, recordRefreshError } from "@/lib/enrichment";
import { env } from "@/lib/env";
import { GitHubError } from "@/lib/github";
import { pruneRateEvents } from "@/lib/guard";
import { db } from "@/lib/supabase";
import type { Company } from "@/lib/types";

export const maxDuration = 300;

/** Leave headroom under maxDuration so a slow GitHub call can't kill the whole run. */
const TIME_BUDGET_MS = 240_000;

/**
 * GET /api/cron/refresh — Vercel Cron (see vercel.json).
 *  - weekly (`0 0 * * 0`): refreshes everything older than 7 days, or never enriched.
 *  - daily  (`?mode=new`): only companies never enriched — so a row Nikhil adds straight
 *    in the Supabase table editor gets intelligence within 24h, without waiting for Sunday.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Refreshes every company whose
 * intelligence is older than 7 days (or missing), oldest first, and stops early on
 * a GitHub rate limit or when the time budget runs out — the next run picks up the rest.
 */
export async function GET(request: Request) {
  const secret = env.cronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
  }

  const started = Date.now();
  const onlyNew = new URL(request.url).searchParams.get("mode") === "new";
  let query = db().from("stale_companies").select("*");
  if (onlyNew) query = query.is("last_refreshed_at", null);
  const { data, error } = await query.order("last_refreshed_at", { ascending: true, nullsFirst: true });
  if (error) return apiError(500, { error: error.message, code: "INTERNAL" });

  const stale = data as Company[];
  const results: { company: string; status: "refreshed" | "failed" | "skipped"; detail?: string }[] = [];
  let halted: string | null = null;

  for (const company of stale) {
    if (halted || Date.now() - started > TIME_BUDGET_MS) {
      results.push({ company: company.github_org, status: "skipped", detail: halted ?? "time budget exhausted" });
      continue;
    }
    try {
      await enrichCompany(company);
      results.push({ company: company.github_org, status: "refreshed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Enrichment failed";
      await recordRefreshError(company.id, message).catch(() => {});
      results.push({ company: company.github_org, status: "failed", detail: message });
      if (err instanceof GitHubError && err.code === "GITHUB_RATE_LIMIT") halted = "GitHub rate limit";
    }
  }

  const summary = {
    mode: onlyNew ? "new" : "stale",
    stale: stale.length,
    refreshed: results.filter((r) => r.status === "refreshed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    durationMs: Date.now() - started,
    results,
  };
  await pruneRateEvents().catch(() => {});
  console.log("[cron] refresh summary", JSON.stringify(summary));
  return NextResponse.json(summary);
}
