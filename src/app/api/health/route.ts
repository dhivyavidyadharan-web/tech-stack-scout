import { connection, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { geminiClient } from "@/lib/gemini";
import { db } from "@/lib/supabase";

/**
 * GET /api/health — integration status for the dashboard's status strip.
 * Reports which integrations are configured (never the secret values) and live GitHub quota.
 */
export async function GET() {
  await connection();
  const token = env.githubToken();
  const geminiKey = env.geminiApiKey();
  const [supabase, github, gemini] = await Promise.all([
    (async () => {
      try {
        const { error } = await db().from("companies").select("id", { head: true, count: "exact" });
        return error ? { ok: false, detail: error.message } : { ok: true };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "Not configured" };
      }
    })(),
    (async () => {
      try {
        const res = await fetch("https://api.github.com/rate_limit", {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "tech-stack-scout",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: "no-store",
        });
        const body = (await res.json()) as { resources?: { core?: { remaining: number; limit: number; reset: number } } };
        const core = body.resources?.core;
        return {
          ok: res.ok,
          authenticated: Boolean(token),
          remaining: core?.remaining ?? null,
          limit: core?.limit ?? null,
          resetAt: core ? new Date(core.reset * 1000).toISOString() : null,
        };
      } catch {
        return { ok: false, authenticated: Boolean(token), remaining: null, limit: null, resetAt: null };
      }
    })(),
    (async () => {
      if (!geminiKey) return { configured: false, ok: false, model: env.geminiModel(), detail: "GEMINI_API_KEY not set" };
      try {
        // Metadata lookup: validates the key + model without spending generation tokens.
        await geminiClient(geminiKey).models.get({ model: env.geminiModel() });
        return { configured: true, ok: true, model: env.geminiModel() };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const detail = /401|403|API key|UNAUTHENTICATED|PERMISSION/i.test(msg)
          ? "Google rejected GEMINI_API_KEY (check the key, or set GEMINI_BASE_URL / GEMINI_USE_VERTEX if your provider requires it)"
          : /404|not found/i.test(msg)
            ? `Model "${env.geminiModel()}" not found — set GEMINI_MODEL`
            : "Gemini unreachable";
        return { configured: true, ok: false, model: env.geminiModel(), detail };
      }
    })(),
  ]);

  return NextResponse.json({
    supabase,
    github,
    gemini,
    cron: { configured: Boolean(env.cronSecret()) },
  });
}
