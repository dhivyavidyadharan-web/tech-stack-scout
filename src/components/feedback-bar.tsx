"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { apiFetch, toastApiError } from "@/lib/client";
import type { Company, EngineeringIntelligence, OpenerFeedback } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tone = "primary" | "technical" | "executive" | "casual";
type Reply = Company["reply_status"];

/**
 * The feedback loop, kept to one row under the opener:
 *  · 👍 / 👎 "Would you send this?" — 👎 makes Gemini write a replacement that avoids
 *    every opener Nikhil has rejected for this company.
 *  · "Got a reply?" Yes / No — the real-world outcome, used to check whether the
 *    complexity score and buying signals actually predict replies.
 */
export function FeedbackBar({
  companyId,
  opener,
  tone,
  feedback,
  replyStatus,
  onBusy,
  onIntelUpdate,
  onReload,
}: {
  companyId: string;
  opener: string | null | undefined;
  tone: Tone;
  feedback: OpenerFeedback[];
  replyStatus: Reply;
  onBusy: (busy: boolean) => void;
  onIntelUpdate: (id: string, intel: EngineeringIntelligence) => void;
  onReload: () => Promise<void>;
}) {
  const [sending, setSending] = useState<"up" | "down" | null>(null);
  const [localRatings, setLocalRatings] = useState<Record<string, 1 | -1>>({});
  const [reply, setReply] = useState<Reply>(replyStatus);
  const [savingReply, setSavingReply] = useState(false);

  // Keep in sync when the server value changes (e.g. after a background sync).
  const [prevReply, setPrevReply] = useState<Reply>(replyStatus);
  if (replyStatus !== prevReply) {
    setPrevReply(replyStatus);
    setReply(replyStatus);
  }

  const rating = opener ? (localRatings[opener] ?? feedback.find((f) => f.opener === opener)?.rating ?? null) : null;

  async function rate(value: "up" | "down") {
    if (!opener || sending) return;
    setSending(value);
    if (value === "down") onBusy(true);
    try {
      const res = await apiFetch<{ replaced: boolean; intelligence?: EngineeringIntelligence; warning?: string }>(
        `/api/feedback/${companyId}`,
        { method: "POST", body: JSON.stringify({ rating: value, opener, tone }) },
      );
      setLocalRatings((r) => ({ ...r, [opener]: value === "up" ? 1 : -1 }));
      if (value === "up") {
        toast.success("Thanks — marked as a good opener");
      } else if (res.replaced && res.intelligence) {
        onIntelUpdate(companyId, res.intelligence);
        toast.success("Got it — Gemini wrote a fresh opener", { description: "It will avoid the style you rejected." });
      } else {
        toast.warning("Feedback saved", { description: res.warning ?? "A new opener couldn't be written right now." });
      }
      await onReload();
    } catch (err) {
      toastApiError(err, "Couldn't save feedback");
    } finally {
      setSending(null);
      onBusy(false);
    }
  }

  async function markReply(next: "replied" | "no_reply") {
    if (savingReply) return;
    const value: Reply = reply === next ? null : next; // clicking the selected option clears it
    setSavingReply(true);
    try {
      await apiFetch(`/api/outcome/${companyId}`, { method: "POST", body: JSON.stringify({ status: value }) });
      setReply(value);
      toast.success(value === "replied" ? "Marked: they replied 🎉" : value === "no_reply" ? "Marked: no reply yet" : "Reply status cleared");
      await onReload();
    } catch (err) {
      toastApiError(err, "Couldn't save reply status");
    } finally {
      setSavingReply(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-dashed px-2.5 py-2 text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Would you send this?</span>
        <FeedbackButton
          label="Thumbs up: good opener"
          active={rating === 1}
          activeClass="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          busy={sending === "up"}
          disabled={!opener || sending !== null}
          onClick={() => rate("up")}
        >
          <ThumbsUp className="size-3.5" />
        </FeedbackButton>
        <FeedbackButton
          label="Thumbs down: write a new opener"
          active={rating === -1}
          activeClass="bg-rose-500/15 text-rose-700 dark:text-rose-300"
          busy={sending === "down"}
          disabled={!opener || sending !== null}
          onClick={() => rate("down")}
        >
          <ThumbsDown className="size-3.5" />
        </FeedbackButton>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Got a reply?</span>
        <div role="group" aria-label="Did the outreach get a reply?" className="flex rounded-md bg-muted p-0.5">
          {(
            [
              ["replied", "Yes"],
              ["no_reply", "No"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={reply === value}
              disabled={savingReply}
              onClick={() => markReply(value)}
              className={cn(
                "rounded px-2 py-0.5 font-medium transition-colors disabled:opacity-60",
                reply === value
                  ? value === "replied"
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-600 text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedbackButton({
  label,
  active,
  activeClass,
  busy,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  activeClass: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md border transition-colors disabled:opacity-60",
        active ? activeClass : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : children}
    </button>
  );
}
