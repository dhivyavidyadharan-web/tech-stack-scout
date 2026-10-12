import { NextResponse } from "next/server";
import { apiError, getCompany, handleError } from "@/lib/api";
import { db } from "@/lib/supabase";

/** DELETE /api/companies/[id] — remove from watchlist (intelligence + history cascade). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/companies/[id]">) {
  try {
    const { id } = await ctx.params;
    const company = await getCompany(id);
    if (!company) return apiError(404, { error: "Company not found", code: "NOT_FOUND" });

    const { error } = await db().from("companies").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: id, name: company.name });
  } catch (err) {
    return handleError(err);
  }
}
