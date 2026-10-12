import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, handleError, loadWatchlist } from "@/lib/api";
import { enrichCompany, recordRefreshError } from "@/lib/enrichment";
import { GitHubError, resolveOwner } from "@/lib/github";
import { guard, MAX_WATCHLIST } from "@/lib/guard";
import { db } from "@/lib/supabase";
import type { Company } from "@/lib/types";

export const maxDuration = 120;

/** GET /api/companies — watchlist with latest intelligence and snapshot history. */
export async function GET() {
  await connection();
  try {
    return NextResponse.json({ companies: await loadWatchlist() });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  github_org: z.string({ error: "GitHub organization is required" }).trim().min(1, "GitHub organization is required").max(100),
  name: z.string().trim().max(120).optional(),
  domain: z.string().trim().max(253).optional(),
});

function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * POST /api/companies — validate the org exists on GitHub, save it, and enrich
 * immediately. If enrichment fails (e.g. rate limit) the company is still saved
 * and the error is returned as a warning so the UI can offer a retry.
 */
export async function POST(request: Request) {
  const blocked = await guard(request, "add");
  if (blocked) return blocked;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(400, { error: parsed.error.issues[0]?.message ?? "Invalid input", code: "VALIDATION" });
  }

  try {
    const owner = await resolveOwner(parsed.data.github_org);
    const handle = owner.login.toLowerCase();
    const supabase = db();

    const { count: total } = await supabase.from("companies").select("id", { head: true, count: "exact" });
    if ((total ?? 0) >= MAX_WATCHLIST) {
      return apiError(400, { error: `The watchlist is capped at ${MAX_WATCHLIST} accounts — remove one first.`, code: "LIMIT_REACHED" });
    }

    const { data: existing } = await supabase.from("companies").select("id,name").eq("github_org", handle).maybeSingle();
    if (existing) {
      return apiError(409, { error: `${existing.name} (@${handle}) is already on your watchlist.`, code: "DUPLICATE" });
    }

    const { data: company, error } = await supabase
      .from("companies")
      .insert({
        name: parsed.data.name || owner.name || owner.login,
        domain: parsed.data.domain || hostnameOf(owner.blog),
        github_org: handle,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    try {
      const intelligence = await enrichCompany(company as Company);
      return NextResponse.json({ company, intelligence }, { status: 201 });
    } catch (enrichErr) {
      const message = enrichErr instanceof Error ? enrichErr.message : "Enrichment failed";
      await recordRefreshError(company.id, message);
      return NextResponse.json(
        {
          company,
          intelligence: null,
          warning: message,
          code: enrichErr instanceof GitHubError ? enrichErr.code : "INTERNAL",
        },
        { status: 201 },
      );
    }
  } catch (err) {
    return handleError(err);
  }
}
