"use client";

import { useState } from "react";
import { useCountUp } from "@/lib/live";

interface Slice {
  label: string;
  value: number;
  color: string;
}

const R = 70;
const STROKE = 22;
const C = 2 * Math.PI * R;
const GAP = 2; // px of surface between segments

/**
 * Part-to-whole donut of confirmed infra signals. Segments are separated by a
 * 2px surface gap; the legend doubles as the value table (count + share), so
 * identity never relies on color alone.
 */
export function StackMix({ slices, total }: { slices: Slice[]; total: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const animatedTotal = useCountUp(total);
  const shown = slices.filter((s) => s.value > 0);

  // Cumulative start offset of each segment along the circumference.
  const lengths = shown.map((s) => (total ? (s.value / total) * C : 0));
  const arcs = shown.map((s, i) => ({
    ...s,
    dash: Math.max(0, lengths[i] - GAP),
    offset: lengths.slice(0, i).reduce((a, b) => a + b, 0),
  }));
  const active = hover ? shown.find((s) => s.label === hover) : null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
      <div className="relative size-44 shrink-0">
        <svg viewBox="0 0 180 180" className="size-full -rotate-90" role="img" aria-label="Infrastructure signal mix across the watchlist">
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.label}
              cx="90"
              cy="90"
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={hover === a.label ? STROKE + 4 : STROKE}
              strokeDasharray={`${a.dash} ${C - a.dash}`}
              strokeDashoffset={-a.offset}
              className="cursor-pointer transition-[stroke-width] duration-200"
              onMouseEnter={() => setHover(a.label)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${a.label}: ${a.value} (${Math.round((a.value / total) * 100)}%)`}</title>
            </circle>
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-3xl font-semibold tabular-nums">
            {active ? active.value : Math.round(animatedTotal)}
          </span>
          <span className="max-w-24 text-[11px] leading-tight text-muted-foreground">
            {active ? active.label : "confirmed tools"}
          </span>
        </div>
      </div>
      <table className="w-full max-w-xs text-xs">
        <caption className="sr-only">Confirmed infrastructure signals by group</caption>
        <tbody>
          {slices.map((s) => (
            <tr
              key={s.label}
              className="cursor-default transition-colors hover:bg-muted/60"
              onMouseEnter={() => setHover(s.label)}
              onMouseLeave={() => setHover(null)}
            >
              <td className="py-1 pr-2">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="whitespace-nowrap text-foreground">{s.label}</span>
                </span>
              </td>
              <td className="py-1 pl-3 text-right font-medium tabular-nums">{s.value}</td>
              <td className="w-14 py-1 pl-3 text-right tabular-nums text-muted-foreground">
                {total ? Math.round((s.value / total) * 100) : 0}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
