"use client";

import { Radio } from "lucide-react";
import type { CompanyActivity } from "@/lib/viz";

/** Scrolling headline strip (pauses on hover; static and scrollable under reduced motion). */
export function Ticker({ items }: { items: CompanyActivity[] }) {
  // Headlines first (round-robin across companies so one busy account can't own the strip);
  // releases only top up a thin news week.
  const news = roundRobin(items.filter((i) => i.kind === "news" || i.kind === "hn")).slice(0, 10);
  const headlines = news.length >= 6 ? news : [...news, ...roundRobin(items.filter((i) => i.kind === "release")).slice(0, 8 - news.length)];
  if (headlines.length === 0) return null;
  // Rendered twice so the -50% keyframe loops seamlessly.
  const loop = [...headlines, ...headlines];
  return (
    <div className="glass flex items-center overflow-hidden rounded-2xl border shadow-soft">
      <span className="flex shrink-0 items-center gap-1.5 border-r bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground">
        <Radio className="size-3.5" /> Live
      </span>
      <div className="ticker relative min-w-0 flex-1 overflow-hidden" aria-label="Latest headlines across your accounts">
        <div className="ticker-track">
          {loop.map((h, i) => (
            <a
              key={`${h.url}-${i}`}
              href={h.url}
              target="_blank"
              rel="noreferrer"
              aria-hidden={i >= headlines.length}
              tabIndex={i >= headlines.length ? -1 : 0}
              className="flex shrink-0 items-center gap-2 px-5 py-2 text-xs whitespace-nowrap hover:text-primary"
            >
              <span className="font-semibold">{h.company}</span>
              <span className="text-muted-foreground">{h.title.length > 90 ? `${h.title.slice(0, 90)}…` : h.title}</span>
              <span aria-hidden className="text-primary">✦</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Interleave items by company, keeping each company's own newest-first order. */
function roundRobin(items: CompanyActivity[]): CompanyActivity[] {
  const byCompany = new Map<string, CompanyActivity[]>();
  for (const i of items) byCompany.set(i.companyId, [...(byCompany.get(i.companyId) ?? []), i]);
  const queues = [...byCompany.values()];
  const out: CompanyActivity[] = [];
  for (let round = 0; queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round]) out.push(q[round]);
  }
  return out;
}
