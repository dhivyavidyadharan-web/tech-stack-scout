"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { format } from "date-fns";
import type { Snapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Change {
  kind: "added" | "removed" | "up" | "down";
  text: string;
}

/** Diff two consecutive snapshots into human-readable stack changes. */
function diff(prev: Snapshot, next: Snapshot): Change[] {
  const changes: Change[] = [];
  const prevTools = new Set(prev.cloud_infra_tools.filter((t) => t.confirmed).map((t) => t.name));
  const nextTools = new Set(next.cloud_infra_tools.filter((t) => t.confirmed).map((t) => t.name));
  nextTools.forEach((t) => !prevTools.has(t) && changes.push({ kind: "added", text: `Adopted ${t}` }));
  prevTools.forEach((t) => !nextTools.has(t) && changes.push({ kind: "removed", text: `No longer seen: ${t}` }));

  if (prev.velocity_score && next.velocity_score && prev.velocity_score !== next.velocity_score) {
    const rank = { Low: 0, Moderate: 1, High: 2 } as const;
    changes.push({
      kind: rank[next.velocity_score] > rank[prev.velocity_score] ? "up" : "down",
      text: `Velocity ${prev.velocity_score} → ${next.velocity_score}`,
    });
  }

  if (prev.open_eng_roles != null && next.open_eng_roles != null && Math.abs(next.open_eng_roles - prev.open_eng_roles) >= 3) {
    const up = next.open_eng_roles > prev.open_eng_roles;
    changes.push({ kind: up ? "up" : "down", text: `Engineering hiring ${prev.open_eng_roles} → ${next.open_eng_roles} open roles` });
  }

  const prevLang = new Map(prev.dominant_languages.map((l) => [l.name, l.percentage]));
  for (const l of next.dominant_languages.slice(0, 5)) {
    const before = prevLang.get(l.name) ?? 0;
    const delta = Math.round((l.percentage - before) * 10) / 10;
    if (Math.abs(delta) >= 5) {
      changes.push({ kind: delta > 0 ? "up" : "down", text: `${l.name} ${delta > 0 ? "+" : ""}${delta} pts of code share` });
    }
  }
  return changes;
}

export function HistoryPanel({ snapshots }: { snapshots: Snapshot[] }) {
  if (snapshots.length === 0) {
    return <p className="text-xs text-muted-foreground">No refreshes recorded yet.</p>;
  }
  // Snapshots arrive newest-first.
  const chronological = [...snapshots].reverse();
  const scores = chronological.map((s) => s.fit_score ?? 0);

  return (
    <div className="space-y-3">
      {scores.length > 1 ? (
        <Sparkline values={scores} />
      ) : (
        <p className="text-xs text-muted-foreground">One refresh so far — changes appear after the next weekly refresh.</p>
      )}
      <ol className="space-y-2">
        {snapshots.map((snap, idx) => {
          const prev = snapshots[idx + 1];
          const changes = prev ? diff(prev, snap) : [];
          return (
            <li key={snap.id} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{format(new Date(snap.captured_at), "MMM d, yyyy · HH:mm")}</span>
                <span className="font-mono text-muted-foreground">
                  fit {snap.fit_score ?? "–"} · {snap.velocity_score ?? "–"} · {snap.commits_30d ?? 0} commits
                </span>
              </div>
              {prev && (
                <ul className="mt-1 space-y-0.5 pl-1">
                  {changes.length === 0 ? (
                    <li className="flex items-center gap-1 text-muted-foreground">
                      <Minus className="size-3" /> No stack changes
                    </li>
                  ) : (
                    changes.map((c) => (
                      <li
                        key={c.text}
                        className={cn(
                          "flex items-center gap-1",
                          c.kind === "added" || c.kind === "up" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400",
                        )}
                      >
                        {c.kind === "added" || c.kind === "up" ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                        {c.text}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 240;
  const h = 36;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 4) - 2]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted-foreground">Fit score over time</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full overflow-visible text-primary" preserveAspectRatio="none" role="img" aria-label="Fit score trend">
        <path d={d} className="fill-none stroke-current" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r="2.5" className="fill-current" />
      </svg>
    </div>
  );
}
