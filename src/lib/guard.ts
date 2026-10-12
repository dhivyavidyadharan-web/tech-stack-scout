import "server-only";
import { apiError } from "./api";
import { db } from "./supabase";

/**
 * Abuse protection for the public write/enrich API. The dashboard is intentionally
 * open (no login, so reviewers can use it), so instead of auth we:
 *  1. reject cross-site requests (another website can't drive our API from a visitor's browser),
 *  2. rate-limit per IP and globally, stored in Supabase so limits hold across serverless instances.
 */

type Action = "add" | "delete" | "enrich" | "pitch";

const LIMITS: Record<Action, { perIp: number; global: number; windowSec: number }> = {
  add: { perIp: 6, global: 40, windowSec: 600 },
  delete: { perIp: 10, global: 40, windowSec: 600 },
  // "Refresh all" on a 30-account watchlist needs 30 calls.
  enrich: { perIp: 40, global: 120, windowSec: 600 },
  pitch: { perIp: 20, global: 80, windowSec: 600 },
};

export const MAX_WATCHLIST = 30;

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Returns an error Response to send, or null when the request may proceed. */
export async function guard(request: Request, action: Action): Promise<Response | null> {
  // 1. Same-site check: browsers always send Origin on POST/DELETE fetches.
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (!host || new URL(origin).host !== host) {
      return apiError(403, { error: "Cross-site requests are not allowed.", code: "FORBIDDEN" });
    }
  }

  // 2. Rate limits (fail open if the limiter itself is unavailable — never block the core workflow on it).
  try {
    const { perIp, global, windowSec } = LIMITS[action];
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const ipBucket = `${action}:${clientIp(request)}`;
    const globalBucket = `${action}:*`;
    const supabase = db();
    const count = async (bucket: string) =>
      (await supabase.from("api_rate_events").select("id", { head: true, count: "exact" }).eq("bucket", bucket).gte("created_at", since))
        .count ?? 0;
    const [ipCount, globalCount] = await Promise.all([count(ipBucket), count(globalBucket)]);
    if (ipCount >= perIp || globalCount >= global) {
      return apiError(429, {
        error: `Too many ${action} requests — please wait a few minutes and try again.`,
        code: "RATE_LIMITED",
        resetAt: new Date(Date.now() + windowSec * 1000).toISOString(),
      });
    }
    await supabase.from("api_rate_events").insert([{ bucket: ipBucket }, { bucket: globalBucket }]);
  } catch (err) {
    console.error("[guard] rate limiter unavailable, allowing request:", err);
  }
  return null;
}

/** Housekeeping for the weekly cron: drop limiter rows older than a day. */
export async function pruneRateEvents() {
  await db().from("api_rate_events").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
}
