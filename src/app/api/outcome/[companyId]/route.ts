import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getCompany, handleError } from "@/lib/api";
import { guard } from "@/lib/guard";
import { db } from "@/lib/supabase";

const bodySchema = z.object({ status: z.enum(["replied", "no_reply"]).nullable() });

/**
 * POST /api/outcome/[companyId] — the real-world result of the outreach:
 * "replied", "no_reply", or null to clear. This is the data needed to check whether
 * engineering complexity and buying signals actually predict replies.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/outcome/[companyId]">) {
  const blocked = await guard(request, "feedback");
  if (blocked) return blocked;
  const { companyId } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError(400, { error: "status must be replied, no_reply or null", code: "VALIDATION" });

  try {
    const company = await getCompany(companyId);
    if (!company) return apiError(404, { error: "Company not found", code: "NOT_FOUND" });
    const { data, error } = await db()
      .from("companies")
      .update({ reply_status: parsed.data.status, reply_updated_at: parsed.data.status ? new Date().toISOString() : null })
      .eq("id", companyId)
      .select("id, reply_status, reply_updated_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (err) {
    return handleError(err);
  }
}
