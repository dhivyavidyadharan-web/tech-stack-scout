"use client";

import Image from "next/image";
import { langColor } from "@/lib/client";
import type { CompanyWithIntel, VelocityScore } from "@/lib/types";
import { cn } from "@/lib/utils";

const VELOCITY_PILL: Record<VelocityScore, string> = {
  High: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Moderate: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Low: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
};

/** Ranked, scannable table — the "Order Status" view of the watchlist. Rows jump to the account card. */
export function Leaderboard({ companies, onJump }: { companies: CompanyWithIntel[]; onJump: (id: string) => void }) {
  const rows = companies
    .filter((c) => c.intelligence?.last_refreshed_at)
    .sort((a, b) => (b.intelligence!.fit_score ?? 0) - (a.intelligence!.fit_score ?? 0));

  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No enriched accounts yet.</p>;

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[800px] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Account</th>
            <th className="px-3 py-2 font-semibold">Stack</th>
            <th className="px-3 py-2 font-semibold">Velocity</th>
            <th className="px-3 py-2 font-semibold">Eng. hiring</th>
            <th className="px-3 py-2 font-semibold" title="Evidence of developer-productivity need (see each account)">Buying signals</th>
            <th className="px-3 py-2 font-semibold" title="Feedback loop: did the outreach get a reply? (set on each card)">Reply</th>
            <th className="px-3 py-2 font-semibold">Complexity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const intel = c.intelligence!;
            const lang = intel.dominant_languages[0];
            const cloud = intel.cloud_infra_tools.find((t) => t.confirmed && ["Cloud", "Hosting", "Orchestration"].includes(t.category));
            const fit = intel.fit_score ?? 0;
            return (
              <tr
                key={c.id}
                onClick={() => onJump(c.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onJump(c.id))}
                tabIndex={0}
                aria-label={`Open ${c.name}`}
                className="cursor-pointer border-t transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
              >
                <td className="px-3 py-2.5 font-display text-base text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Image
                      src={`https://github.com/${c.github_org}.png?size=64`}
                      alt=""
                      width={28}
                      height={28}
                      className="size-7 rounded-lg bg-muted"
                    />
                    <div>
                      <div className="font-semibold leading-tight">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground">@{c.github_org}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {lang && (
                      <span className="inline-flex items-center gap-1">
                        <span className="size-2 rounded-full" style={{ background: langColor(lang.name) }} />
                        {lang.name}
                      </span>
                    )}
                    {cloud && <span className="rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">{cloud.name}</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {intel.velocity_score && (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", VELOCITY_PILL[intel.velocity_score])}>
                      {intel.velocity_score}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs tabular-nums">
                  {intel.hiring_signals && intel.hiring_signals.totalRoles > 0 ? (
                    `${intel.hiring_signals.engineeringRoles} roles`
                  ) : (
                    // Empty or missing public board: unknown, not "zero hiring".
                    <span className="text-muted-foreground" title="No active public job board found">n/a</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs tabular-nums">
                  {intel.buying_signals?.length ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{intel.buying_signals.length}</span>
                  ) : (
                    <span className="text-muted-foreground">none</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {c.reply_status === "replied" ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">Replied</span>
                  ) : c.reply_status === "no_reply" ? (
                    <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 font-semibold text-zinc-600 dark:text-zinc-300">No reply</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--series-1)] to-[var(--series-2)] transition-[width] duration-700"
                        style={{ width: `${fit}%` }}
                      />
                    </div>
                    <span className="w-7 text-right text-xs font-semibold tabular-nums">{fit}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
