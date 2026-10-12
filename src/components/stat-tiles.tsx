"use client";

import { Activity, Building2, Gauge, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCountUp } from "@/lib/live";
import { cn } from "@/lib/utils";

export interface TileSpec {
  key: string;
  label: string;
  value: number | null;
  sub: string;
  /** Mini-chart values, one per account or per day. */
  bars: { label: string; value: number }[];
  gradient: string;
  icon: "accounts" | "velocity" | "fit" | "signals";
}

const ICONS = { accounts: Building2, velocity: Activity, fit: Gauge, signals: Zap };

export function StatTiles({ tiles }: { tiles: TileSpec[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <Tile key={t.key} tile={t} />
      ))}
    </div>
  );
}

function Tile({ tile }: { tile: TileSpec }) {
  const animated = useCountUp(tile.value ?? 0);
  const Icon = ICONS[tile.icon];
  const max = Math.max(1, ...tile.bars.map((b) => b.value));
  return (
    <section
      aria-label={tile.label}
      className={cn("sheen hover-glow relative rounded-2xl p-5 text-white shadow-soft", tile.gradient)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
          <span className="flex size-7 items-center justify-center rounded-lg bg-white/20">
            <Icon className="size-3.5" />
          </span>
          {tile.label}
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          {tile.value === null ? (
            <Skeleton className="h-9 w-16 bg-white/30" />
          ) : (
            <div className="font-display text-4xl font-semibold leading-none tabular-nums">{Math.round(animated)}</div>
          )}
          <div className="mt-1.5 text-xs text-white/80">{tile.sub}</div>
        </div>
        {/* Mini bars: white on the gradient, values in a tooltip and the screen-reader label. */}
        <div className="flex h-12 items-end gap-1" role="img" aria-label={tile.bars.map((b) => `${b.label}: ${b.value}`).join(", ")}>
          {tile.bars.slice(0, 10).map((b) => (
            <span
              key={b.label}
              title={`${b.label}: ${b.value}`}
              className="w-1.5 rounded-t-[3px] bg-white/80 transition-[height] duration-700"
              style={{ height: `${Math.max(8, (b.value / max) * 100)}%` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
