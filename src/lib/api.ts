import "server-only";
import { NextResponse } from "next/server";
import { GitHubError } from "./github";
import type { ApiError, Company, CompanyWithIntel, EngineeringIntelligence, Snapshot } from "./types";
import { db } from "./supabase";

export function apiError(status: number, body: ApiError) {
  return NextResponse.json(body, { status });
}

/** Map any thrown error to a consistent JSON envelope the UI can toast on. */
export function handleError(err: unknown) {
  if (err instanceof GitHubError) {
    return apiError(err.code === "GITHUB_RATE_LIMIT" ? 429 : err.status === 404 ? 404 : 502, {
      error: err.message,
      code: err.code,
      resetAt: err.resetAt,
    });
  }
  console.error("[api] unexpected error:", err);
  return apiError(500, {
    error: err instanceof Error ? err.message : "Unexpected server error",
    code: "INTERNAL",
  });
}

const SNAPSHOTS_PER_COMPANY = 12;

/** Load the watchlist joined with latest intelligence + recent snapshot history. */
export async function loadWatchlist(): Promise<CompanyWithIntel[]> {
  const supabase = db();
  const [companies, intel, snaps] = await Promise.all([
    supabase.from("companies").select("*").order("created_at", { ascending: true }),
    supabase.from("engineering_intelligence").select("*"),
    supabase
      .from("intelligence_snapshots")
      .select("*")
      .order("captured_at", { ascending: false })
      .limit(500),
  ]);
  if (companies.error) throw new Error(companies.error.message);
  if (intel.error) throw new Error(intel.error.message);
  if (snaps.error) throw new Error(snaps.error.message);

  const byCompany = new Map((intel.data as EngineeringIntelligence[]).map((i) => [i.company_id, i]));
  const snapsByCompany = new Map<string, Snapshot[]>();
  for (const s of snaps.data as Snapshot[]) {
    const list = snapsByCompany.get(s.company_id) ?? [];
    if (list.length < SNAPSHOTS_PER_COMPANY) list.push(s);
    snapsByCompany.set(s.company_id, list);
  }

  return (companies.data as Company[]).map((c) => ({
    ...c,
    intelligence: byCompany.get(c.id) ?? null,
    snapshots: snapsByCompany.get(c.id) ?? [],
  }));
}

export async function getCompany(id: string): Promise<Company | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db().from("companies").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Company | null;
}
