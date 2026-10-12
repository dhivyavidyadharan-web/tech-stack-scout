"use client";

import { useState } from "react";
import { FileText, FolderPlus, Newspaper, Rocket, TrendingUp } from "lucide-react";
import { ago } from "@/lib/client";
import { useNow } from "@/lib/live";
import type { CompanyActivity } from "@/lib/viz";
import { cn } from "@/lib/utils";

const KIND = {
  news: { icon: Newspaper, label: "In the news", tone: "bg-[var(--series-1)]" },
  release: { icon: Rocket, label: "Shipped a release", tone: "bg-[var(--series-2)]" },
  hn: { icon: TrendingUp, label: "Trending on HN", tone: "bg-[var(--series-3)]" },
  repo: { icon: FolderPlus, label: "Opened a new repo", tone: "bg-[var(--series-4)]" },
  blog: { icon: FileText, label: "Published a post", tone: "bg-[var(--series-5)]" },
} as const;

const keyOf = (i: CompanyActivity) => `${i.companyId}:${i.kind}:${i.url}`;

/**
 * Cross-account activity timeline. Items that appear after a background sync
 * flash briefly so a live change is noticeable; relative times tick every 30s.
 */
export function LiveFeed({ items, onJump }: { items: CompanyActivity[]; onJump: (companyId: string) => void }) {
  useNow(30_000);
  // Derived state from the previous render: anything not seen last time is "fresh".
  const [prevItems, setPrevItems] = useState(items);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  if (items !== prevItems) {
    const before = new Set(prevItems.map(keyOf));
    setFresh(new Set(items.map(keyOf).filter((k) => !before.has(k))));
    setPrevItems(items);
  }

  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No recent activity yet. Refresh accounts to start the feed.</p>;
  }

  return (
    <ol className="relative space-y-1">
      {/* timeline rail */}
      <span aria-hidden className="absolute top-3 bottom-3 left-[83px] w-px bg-border" />
      {items.map((item) => {
        const k = KIND[item.kind];
        const Icon = k.icon;
        return (
          <li key={keyOf(item)} className={cn("relative flex items-start gap-3 px-1 py-2", fresh.has(keyOf(item)) && "fresh")}>
            <span className="w-16 shrink-0 pt-1.5 text-right text-[11px] tabular-nums text-muted-foreground" suppressHydrationWarning>
              {item.date ? ago(item.date).replace(" ago", "") : ""}
            </span>
            <span className={cn("relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-white ring-4 ring-card", k.tone)}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug">
                {k.label}
                <span className="font-normal text-muted-foreground"> · </span>
                <button onClick={() => onJump(item.companyId)} className="font-semibold text-primary hover:underline">
                  {item.company}
                </button>
              </p>
              <a href={item.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                {item.title}
              </a>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
