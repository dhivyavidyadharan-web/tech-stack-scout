"use client";

import { useId, useMemo, useState } from "react";
import { format } from "date-fns";
import { PULSE_SERIES, type PulseWeek } from "@/lib/viz";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 32 };

/**
 * Weekly activity across the watchlist. One y-axis (event count), 2px lines,
 * soft area fill, recessive grid, legend + end-of-line direct labels, and a
 * crosshair tooltip. Smoothed with a monotone curve so it never overshoots 0.
 */
export function ActivityPulse({ weeks }: { weeks: PulseWeek[] }) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const { xs, y, ticks, paths } = useMemo(() => {
    const max = Math.max(4, ...weeks.flatMap((w) => PULSE_SERIES.map((s) => w.values[s.key])));
    const niceMax = Math.ceil(max / 4) * 4;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const xs = weeks.map((_, i) => PAD.left + (weeks.length === 1 ? innerW / 2 : (i / (weeks.length - 1)) * innerW));
    const y = (v: number) => PAD.top + innerH - (v / niceMax) * innerH;
    const ticks = [0, niceMax / 4, niceMax / 2, (3 * niceMax) / 4, niceMax];
    const paths = PULSE_SERIES.map((s) => {
      const pts = weeks.map((w, i) => [xs[i], y(w.values[s.key])] as const);
      const line = monotonePath(pts);
      const area = `${line} L${xs[xs.length - 1]},${y(0)} L${xs[0]},${y(0)} Z`;
      return { ...s, line, area, last: pts[pts.length - 1] };
    });
    return { xs, y, ticks, paths };
  }, [weeks]);

  const total = (w: PulseWeek) => PULSE_SERIES.reduce((s, x) => s + w.values[x.key], 0);

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {PULSE_SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label={`Weekly activity across the watchlist over the last ${weeks.length} weeks`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            {paths.map((p) => (
              <linearGradient key={p.key} id={`${gid}-${p.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={p.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={p.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
                {t}
              </text>
            </g>
          ))}
          {weeks.map((w, i) => (
            <text key={i} x={xs[i]} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {format(w.start, "MMM d")}
            </text>
          ))}
          {paths.map((p) => (
            <path key={`a-${p.key}`} d={p.area} fill={`url(#${gid}-${p.key})`} />
          ))}
          {paths.map((p) => (
            <path key={`l-${p.key}`} d={p.line} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={xs[hover]} x2={xs[hover]} y1={PAD.top} y2={y(0)} stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeDasharray="3 3" />
              {paths.map((p) => (
                <circle key={p.key} cx={xs[hover]} cy={y(weeks[hover].values[p.key])} r={4.5} fill={p.color} stroke="var(--card)" strokeWidth={2} />
              ))}
            </g>
          )}
          {/* Hit targets: full-height column per week, wider than the mark. */}
          {weeks.map((_, i) => {
            const left = i === 0 ? PAD.left : (xs[i - 1] + xs[i]) / 2;
            const right = i === weeks.length - 1 ? W - PAD.right : (xs[i] + xs[i + 1]) / 2;
            return (
              <rect
                key={i}
                x={left}
                y={PAD.top}
                width={right - left}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={0}
                aria-label={`Week of ${format(weeks[i].start, "MMM d")}: ${PULSE_SERIES.map((s) => `${s.label} ${weeks[i].values[s.key]}`).join(", ")}`}
              />
            );
          })}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-40 -translate-x-1/2 rounded-xl border bg-popover px-3 py-2 text-xs shadow-soft"
            style={{ left: `${(xs[hover] / W) * 100}%` }}
          >
            <div className="mb-1 font-semibold">Week of {format(weeks[hover].start, "MMM d")}</div>
            {PULSE_SERIES.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums">{weeks[hover].values[s.key]}</span>
              </div>
            ))}
            <div className="mt-1 border-t pt-1 text-muted-foreground">Total {total(weeks[hover])}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Monotone cubic interpolation (Fritsch–Carlson): smooth, never overshoots. */
function monotonePath(pts: readonly (readonly [number, number])[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      t[i] = (3 / h) * a * m[i];
      t[i + 1] = (3 / h) * b * m[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    d += ` C${x0 + dx[i] / 3},${y0 + (t[i] * dx[i]) / 3} ${x1 - dx[i] / 3},${y1 - (t[i + 1] * dx[i]) / 3} ${x1},${y1}`;
  }
  return d;
}
