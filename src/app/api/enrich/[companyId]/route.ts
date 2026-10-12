import { NextResponse } from "next/server";
import { apiError, getCompany, handleError } from "@/lib/api";
import { enrichCompany, recordRefreshError } from "@/lib/enrichment";

export const maxDuration = 120;

/**
 * POST /api/enrich/[companyId]
 * GitHub (live) → language/recency/infra aggregation → Gemini Flash narrative → upsert.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/enrich/[companyId]">) {
  const { companyId } = await ctx.params;
  try {
    const company = await getCompany(companyId);
    if (!company) return apiError(404, { error: "Company not found", code: "NOT_FOUND" });

    const intelligence = await enrichCompany(company);
    return NextResponse.json({ intelligence });
  } catch (err) {
    await recordRefreshError(companyId, err instanceof Error ? err.message : "Enrichment failed").catch(() => {});
    return handleError(err);
  }
}
