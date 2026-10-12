import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, handleError } from "@/lib/api";
import { regeneratePitch } from "@/lib/gemini";
import { db } from "@/lib/supabase";
import type { EngineeringIntelligence, PitchTone, RawStats } from "@/lib/types";

export const maxDuration = 30;

const bodySchema = z.object({
  tone: z.enum(["technical", "executive", "casual"]),
  /** Also make this the primary outreach hook. */
  makePrimary: z.boolean().optional(),
});

/**
 * POST /api/pitch/[companyId] — regenerate one outreach hook in a chosen tone
 * from cached GitHub stats (Gemini Flash only; zero GitHub API calls).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/pitch/[companyId]">) {
  const { companyId } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError(400, { error: "tone must be technical | executive | casual", code: "VALIDATION" });

  try {
    const supabase = db();
    const { data, error } = await supabase
      .from("engineering_intelligence")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const intel = data as EngineeringIntelligence | null;
    if (!intel || !intel.velocity_score || !("org" in intel.raw_stats)) {
      return apiError(404, { error: "Refresh intelligence before generating pitches.", code: "NOT_FOUND" });
    }

    const tone = parsed.data.tone as PitchTone;
    const avoid = [intel.pitch_variants[tone], intel.outreach_pitch].filter((p): p is string => Boolean(p));
    const { pitch } = await regeneratePitch(intel.raw_stats as RawStats, intel.velocity_score, tone, avoid);

    const update: Partial<EngineeringIntelligence> = {
      pitch_variants: { ...intel.pitch_variants, [tone]: pitch },
      ...(parsed.data.makePrimary ? { outreach_pitch: pitch } : {}),
    };
    const { data: saved, error: saveError } = await supabase
      .from("engineering_intelligence")
      .update(update)
      .eq("company_id", companyId)
      .select()
      .single();
    if (saveError) throw new Error(saveError.message);

    return NextResponse.json({ pitch, intelligence: saved });
  } catch (err) {
    return handleError(err);
  }
}
