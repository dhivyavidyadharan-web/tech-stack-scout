import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getCompany, handleError } from "@/lib/api";
import { regeneratePitch } from "@/lib/gemini";
import { guard } from "@/lib/guard";
import { db } from "@/lib/supabase";
import type { EngineeringIntelligence, PitchTone, RawStats } from "@/lib/types";

export const maxDuration = 60;

const bodySchema = z.object({
  rating: z.enum(["up", "down"]),
  opener: z.string().min(5).max(600),
  tone: z.enum(["primary", "technical", "executive", "casual"]),
});

/**
 * POST /api/feedback/[companyId] — the feedback loop.
 * Saves Nikhil's 👍/👎 on an opener. On 👎, Gemini immediately writes a replacement
 * for that tone, told to avoid every opener he has rejected for this company.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/feedback/[companyId]">) {
  const blocked = await guard(request, "feedback");
  if (blocked) return blocked;
  const { companyId } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError(400, { error: "Send rating (up|down), opener and tone.", code: "VALIDATION" });

  try {
    const company = await getCompany(companyId);
    if (!company) return apiError(404, { error: "Company not found", code: "NOT_FOUND" });
    const { rating, opener, tone } = parsed.data;
    const supabase = db();

    const { error: insertError } = await supabase
      .from("opener_feedback")
      .insert({ company_id: companyId, opener, tone, rating: rating === "up" ? 1 : -1 });
    if (insertError) throw new Error(insertError.message);

    if (rating === "up") return NextResponse.json({ saved: true, replaced: false });

    // 👎 → write a fresh opener that avoids everything he has rejected for this company.
    const { data } = await supabase.from("engineering_intelligence").select("*").eq("company_id", companyId).maybeSingle();
    const intel = data as EngineeringIntelligence | null;
    if (!intel?.velocity_score || !("org" in intel.raw_stats)) {
      return NextResponse.json({ saved: true, replaced: false });
    }
    const { data: rejected } = await supabase
      .from("opener_feedback")
      .select("opener")
      .eq("company_id", companyId)
      .eq("rating", -1)
      .order("created_at", { ascending: false })
      .limit(8);
    const avoid = [...new Set([opener, ...(rejected ?? []).map((r) => r.opener as string)])];

    try {
      const voice: PitchTone = tone === "primary" ? "technical" : tone;
      const { pitch } = await regeneratePitch(intel.raw_stats as RawStats, intel.velocity_score, voice, avoid);
      const update: Partial<EngineeringIntelligence> =
        tone === "primary"
          ? { outreach_pitch: pitch, pitch_variants: { ...intel.pitch_variants, angle: undefined, hookType: undefined, hookEvidence: undefined } }
          : { pitch_variants: { ...intel.pitch_variants, [tone]: pitch } };
      const { data: saved, error } = await supabase
        .from("engineering_intelligence")
        .update(update)
        .eq("company_id", companyId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ saved: true, replaced: true, pitch, intelligence: saved });
    } catch (err) {
      // The rating is saved even if Gemini can't write a replacement right now.
      console.error("[feedback] replacement opener failed:", err);
      return NextResponse.json({ saved: true, replaced: false, warning: "Feedback saved, but a new opener couldn't be written right now." });
    }
  } catch (err) {
    return handleError(err);
  }
}
