import { connection } from "next/server";
import { handleError, loadWatchlist } from "@/lib/api";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** GET /api/export — the whole watchlist as CSV, ready for a CRM import. */
export async function GET() {
  await connection();
  try {
    const rows = await loadWatchlist();
    const header = [
      "Company", "Domain", "GitHub", "Overview", "Engineering Complexity", "Velocity", "Active Repos (30d)", "Commits (30d)",
      "Last Commit", "Top Languages", "Infrastructure (confirmed)", "Microservices", "Open Eng Roles", "Tools in Job Posts", "Latest News", "Latest Release", "Latest Blog Post", "Reply Status", "Openers 👍", "Openers 👎", "Outreach Hook", "Engineering Summary", "Last Refreshed",
    ];
    const lines = rows.map((c) => {
      const i = c.intelligence;
      return [
        c.name,
        c.domain,
        `https://github.com/${c.github_org}`,
        i?.overview,
        i?.fit_score,
        i?.velocity_score,
        i?.active_repo_count,
        i?.commits_30d,
        i?.last_commit_date,
        i?.dominant_languages.slice(0, 4).map((l) => `${l.name} ${l.percentage}%`).join("; "),
        i?.cloud_infra_tools.filter((t) => t.confirmed).map((t) => t.name).join("; "),
        i && "microservices" in i.architecture ? i.architecture.microservices : "",
        i?.hiring_signals?.engineeringRoles,
        i?.hiring_signals?.tools.map((t) => `${t.name} (${t.count})`).join("; "),
        i?.news?.find((n) => n.kind === "news")?.title,
        i && "releases" in i.building ? i.building.releases[0] && `${i.building.releases[0].repo} ${i.building.releases[0].tag}` : "",
        i?.blog_posts?.[0]?.title,
        c.reply_status ?? "",
        (c.feedback ?? []).filter((f) => f.rating === 1).length,
        (c.feedback ?? []).filter((f) => f.rating === -1).length,
        i?.outreach_pitch,
        i?.engineering_summary?.replace(/\n\n/g, " ¶ "),
        i?.last_refreshed_at,
      ].map(csvCell).join(",");
    });
    const csv = [header.map(csvCell).join(","), ...lines].join("\r\n");
    const date = new Date().toISOString().slice(0, 10);
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="dora-watchlist-${date}.csv"`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
