"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, toastApiError } from "@/lib/client";
import type { Company, EngineeringIntelligence } from "@/lib/types";

const SUGGESTIONS = ["stripe", "shopify", "netflix", "datadog", "grafana", "temporalio"];

interface Props {
  existingOrgs: string[];
  onAdded: (company: Company, intelligence: EngineeringIntelligence | null) => void;
}

export function AddCompanyDialog({ existingOrgs, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOrg("");
    setName("");
    setDomain("");
    setError(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org.trim()) {
      setError("Enter a GitHub organization handle.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const toastId = toast.loading(`Scouting @${org.trim()}…`, {
      description: "Validating org, scanning repos and asking Gemini for context.",
    });
    try {
      const res = await apiFetch<{
        company: Company;
        intelligence: EngineeringIntelligence | null;
        warning?: string;
      }>("/api/companies", {
        method: "POST",
        body: JSON.stringify({ github_org: org, name: name || undefined, domain: domain || undefined }),
      });
      toast.dismiss(toastId);
      if (res.warning) {
        toast.warning(`${res.company.name} added, but enrichment failed`, {
          description: `${res.warning} Use "Refresh Intelligence" to retry.`,
          duration: 10_000,
        });
      } else {
        toast.success(`${res.company.name} added`, { description: "Engineering intelligence is ready." });
      }
      onAdded(res.company, res.intelligence);
      reset();
      setOpen(false);
    } catch (err) {
      toast.dismiss(toastId);
      setError(err instanceof Error ? err.message : "Failed to add company");
      toastApiError(err, "Could not add company");
    } finally {
      setSubmitting(false);
    }
  }

  const suggestions = SUGGESTIONS.filter((s) => !existingOrgs.includes(s)).slice(0, 4);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus /> Add Target Company
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add target company</DialogTitle>
            <DialogDescription>
              We&apos;ll check the GitHub org exists, scan its 30 most recently pushed repos and generate an engineering
              brief.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="org">GitHub organization *</Label>
            <div className="flex items-center rounded-lg border border-input focus-within:ring-3 focus-within:ring-ring/50">
              <span className="pl-2.5 text-sm text-muted-foreground">github.com/</span>
              <Input
                id="org"
                autoFocus
                placeholder="vercel"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                aria-invalid={Boolean(error)}
                disabled={submitting}
              />
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                Try:
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setOrg(s)}
                    className="rounded-md border px-1.5 py-0.5 font-mono hover:bg-muted"
                    disabled={submitting}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="name">Display name</Label>
              <Input id="name" placeholder="From GitHub" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="domain">Domain</Label>
              <Input id="domain" placeholder="From GitHub" value={domain} onChange={(e) => setDomain(e.target.value)} disabled={submitting} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" /> Scouting…
                </>
              ) : (
                "Add & enrich"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
