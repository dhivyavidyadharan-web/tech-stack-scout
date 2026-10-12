import type { Architecture, EvidenceSource, InfraCategory, InfraTool, MicroservicesVerdict } from "./types";

/** Signals gathered for one repository. Deep-scanned repos carry paths + deps; all repos carry text. */
export interface RepoSignals {
  repo: string;
  /** Every file path in the repo tree (deep scan only). */
  paths: string[];
  /** package.json dependency names (deep scan only). */
  deps: string[];
  /** name + description + topics (shallow scan for every repo). */
  text: string;
}

interface Rule {
  name: string;
  category: InfraCategory;
  path?: RegExp;
  deps?: RegExp;
  keyword?: RegExp;
}

const base = (p: string) => p.split("/").pop() ?? p;

// Ordered roughly by how strong a buying signal they are for a dev-productivity tool.
const RULES: Rule[] = [
  { name: "Docker", category: "Container", path: /(^|\/)(Dockerfile(\.[\w-]+)?|[\w-]+\.dockerfile|(docker-)?compose(\.[\w-]+)?\.ya?ml)$/i, keyword: /\bdocker\b/i },
  { name: "Kubernetes", category: "Orchestration", path: /(^|\/)(Chart\.yaml|kustomization\.ya?ml|skaffold\.ya?ml)$|(^|\/)(k8s|kubernetes|helm)\/.*\.ya?ml$/i, keyword: /\b(kubernetes|k8s|helm|kubectl)\b/i },
  { name: "Terraform", category: "IaC", path: /\.tf$/i, deps: /^cdktf$/, keyword: /\bterraform\b/i },
  { name: "Pulumi", category: "IaC", path: /(^|\/)Pulumi\.ya?ml$/, deps: /^@pulumi\//, keyword: /\bpulumi\b/i },
  { name: "AWS", category: "Cloud", path: /(^|\/)(cdk\.json|serverless\.ya?ml|samconfig\.toml|buildspec\.ya?ml)$/i, deps: /^(aws-sdk|@aws-sdk\/|aws-cdk-lib|@aws-cdk\/|sst)/, keyword: /\b(aws|amazon[- ]web[- ]services|lambda|dynamodb|cloudformation)\b/i },
  { name: "GCP", category: "Cloud", path: /(^|\/)cloudbuild\.ya?ml$/i, deps: /^(@google-cloud\/|firebase-admin)/, keyword: /\b(gcp|google[- ]cloud|bigquery|cloud[- ]run|gke)\b/i },
  { name: "Azure", category: "Cloud", path: /(^|\/)azure-pipelines\.ya?ml$/i, deps: /^@azure\//, keyword: /\bazure\b/i },
  { name: "Cloudflare", category: "Hosting", path: /(^|\/)wrangler\.(toml|jsonc?)$/, deps: /^(wrangler|@cloudflare\/)/, keyword: /\bcloudflare\b/i },
  { name: "Vercel", category: "Hosting", path: /(^|\/)vercel\.json$/, deps: /^@vercel\//, keyword: /\bvercel\b/i },
  { name: "Netlify", category: "Hosting", path: /(^|\/)netlify\.toml$/ },
  { name: "Fly.io", category: "Hosting", path: /(^|\/)fly\.toml$/ },
  { name: "GitHub Actions", category: "CI/CD", path: /^\.github\/workflows\/[^/]+\.ya?ml$/, keyword: /\bgithub[- ]actions?\b/i },
  { name: "CircleCI", category: "CI/CD", path: /^\.circleci\/config\.ya?ml$/ },
  { name: "GitLab CI", category: "CI/CD", path: /(^|\/)\.gitlab-ci\.ya?ml$/ },
  { name: "Jenkins", category: "CI/CD", path: /(^|\/)Jenkinsfile$/, keyword: /\bjenkins\b/i },
  { name: "Buildkite", category: "CI/CD", path: /^\.buildkite\// },
  { name: "Turborepo", category: "Monorepo", path: /(^|\/)turbo\.json$/, deps: /^turbo$/ },
  { name: "Nx", category: "Monorepo", path: /(^|\/)nx\.json$/, deps: /^nx$/ },
  { name: "pnpm Workspaces", category: "Monorepo", path: /^pnpm-workspace\.ya?ml$/ },
  { name: "Lerna", category: "Monorepo", path: /^lerna\.json$/, deps: /^lerna$/ },
  { name: "Bazel", category: "Monorepo", path: /(^|\/)(WORKSPACE(\.bazel)?|MODULE\.bazel|BUILD\.bazel)$/, keyword: /\bbazel\b/i },
  { name: "OpenTelemetry", category: "Observability", deps: /^@opentelemetry\//, keyword: /\bopen-?telemetry\b/i },
  { name: "Sentry", category: "Observability", deps: /^@sentry\//, keyword: /\bsentry\b/i },
  { name: "Prometheus/Grafana", category: "Observability", keyword: /\b(prometheus|grafana)\b/i },
];

const MAX_EVIDENCE = 4;

/**
 * Pure function: turn raw repo signals into deduplicated infra tags with evidence.
 * Deep-scan evidence (actual files) is listed before keyword matches so the
 * strongest proof is shown first in the UI.
 */
export function detectInfra(signals: RepoSignals[], org?: string): InfraTool[] {
  const found = new Map<string, InfraTool & { strong: number }>();
  const repoUrl = (repo: string) => (org ? `https://github.com/${org}/${repo}` : "");

  const add = (rule: Rule, evidence: string, strong: boolean, source?: EvidenceSource) => {
    const entry = found.get(rule.name) ?? {
      name: rule.name,
      category: rule.category,
      evidence: [],
      confirmed: false,
      sources: [],
      strong: 0,
    };
    if (strong) entry.strong++;
    if (!entry.evidence.includes(evidence) && entry.evidence.length < MAX_EVIDENCE) {
      if (strong) entry.evidence.unshift(evidence);
      else entry.evidence.push(evidence);
      entry.evidence = entry.evidence.slice(0, MAX_EVIDENCE);
    }
    if (source?.url && !entry.sources!.some((x) => x.url === source.url) && entry.sources!.length < MAX_EVIDENCE) {
      if (strong) entry.sources!.unshift(source);
      else entry.sources!.push(source);
      entry.sources = entry.sources!.slice(0, MAX_EVIDENCE);
    }
    found.set(rule.name, entry);
  };

  for (const s of signals) {
    for (const rule of RULES) {
      if (rule.path) {
        const hit = s.paths.find((p) => rule.path!.test(p));
        if (hit) {
          add(rule, `${s.repo}: ${hit.length > 48 ? "…/" + base(hit) : hit}`, true, {
            label: `${s.repo}/${hit}`,
            url: org ? `${repoUrl(s.repo)}/blob/HEAD/${hit}` : "",
            kind: "file",
          });
        }
      }
      if (rule.deps) {
        const dep = s.deps.find((d) => rule.deps!.test(d));
        if (dep) {
          add(rule, `${s.repo}: depends on ${dep}`, true, {
            label: `${s.repo}/package.json → ${dep}`,
            url: org ? `${repoUrl(s.repo)}/blob/HEAD/package.json` : "",
            kind: "manifest",
          });
        }
      }
      if (rule.keyword && s.text && rule.keyword.test(s.text)) {
        add(rule, `${s.repo}: mentioned in repo name/description/topics`, false, {
          label: `${s.repo} (name, description or topics)`,
          url: repoUrl(s.repo),
          kind: "mention",
        });
      }
    }
  }

  const order = RULES.map((r) => r.name);
  return [...found.values()]
    .sort((a, b) => b.strong - a.strong || order.indexOf(a.name) - order.indexOf(b.name))
    .map(({ name, category, evidence, sources, strong }) => ({ name, category, evidence, sources, confirmed: strong > 0 }));
}

// ── Architecture: microservices detection ────────────────────────────────────

const DOCKERFILE = /(^|\/)(Dockerfile(\.[\w-]+)?|[\w-]+\.dockerfile)$/i;
const SERVICE_ROOT = /^(services|apps|cmd|svc|microservices)\/([^/]+)\/(package\.json|go\.mod|Cargo\.toml|pyproject\.toml|pom\.xml|build\.gradle(\.kts)?|Dockerfile)$/;

/**
 * Microservices are a key fit signal for the seller. We look for structural
 * evidence in deep-scanned repos, not keywords:
 *  - many Dockerfiles in separate directories (independently deployable units)
 *  - several deployable roots under services/ apps/ cmd/
 *  - Protobuf/gRPC contracts between services
 *  - Kubernetes / Helm manifests
 * Job-post mentions are added by the caller via `withHiringEvidence`.
 */
export function detectArchitecture(signals: RepoSignals[]): Architecture {
  const strong: string[] = [];
  const weak: string[] = [];

  for (const s of signals) {
    if (!s.paths.length) continue;
    const dockerDirs = new Set(s.paths.filter((p) => DOCKERFILE.test(p)).map((p) => p.split("/").slice(0, -1).join("/") || "."));
    if (dockerDirs.size >= 3) strong.push(`${s.repo}: ${dockerDirs.size} Dockerfiles in separate directories`);

    const serviceRoots = new Set(
      s.paths.map((p) => p.match(SERVICE_ROOT)).filter((m): m is RegExpMatchArray => Boolean(m)).map((m) => `${m[1]}/${m[2]}`),
    );
    if (serviceRoots.size >= 3) {
      const dir = [...serviceRoots][0].split("/")[0];
      strong.push(`${s.repo}: ${serviceRoots.size} deployable units under ${dir}/`);
    }

    const protos = s.paths.filter((p) => p.endsWith(".proto")).length;
    if (protos >= 3) strong.push(`${s.repo}: ${protos} Protobuf/gRPC contracts`);

    const k8s = s.paths.find((p) => /(^|\/)(Chart\.yaml|kustomization\.ya?ml)$|(^|\/)(k8s|kubernetes|helm)\/.*\.ya?ml$/i.test(p));
    if (k8s) strong.push(`${s.repo}: Kubernetes manifests (${k8s.split("/").pop()})`);

    const compose = s.paths.find((p) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(p));
    if (compose) weak.push(`${s.repo}: multi-container setup (${compose.split("/").pop()})`);
  }

  return verdictFrom([...new Set(strong)], [...new Set(weak)]);
}

/** Fold job-posting evidence into the architecture verdict. */
export function withHiringEvidence(arch: Architecture, microservicesMentions: number, totalEngRoles: number): Architecture {
  if (!microservicesMentions) return arch;
  const signal = `Jobs: ${microservicesMentions} of ${totalEngRoles} engineering postings mention microservices/distributed systems`;
  const strong = arch.signals.filter((s) => !s.includes("multi-container"));
  const weak = arch.signals.filter((s) => s.includes("multi-container"));
  return verdictFrom([...strong, signal], weak);
}

function verdictFrom(strong: string[], weak: string[]): Architecture {
  const microservices: MicroservicesVerdict = strong.length >= 2 ? "Likely" : strong.length === 1 || weak.length >= 2 ? "Possible" : "Unlikely";
  return { microservices, signals: [...strong, ...weak].slice(0, 6) };
}

/** Merge tools found in job descriptions into the infra list as confirmed evidence. */
export function withJobEvidence(
  infra: InfraTool[],
  tools: { name: string; count: number }[],
  provider: string,
  boardUrl?: string,
): InfraTool[] {
  const known = new Map(RULES.map((r) => [r.name, r.category]));
  const out = infra.map((t) => ({ ...t, evidence: [...t.evidence], sources: [...(t.sources ?? [])] }));
  for (const tool of tools) {
    const category = known.get(tool.name);
    if (!category) continue; // languages/datastores are shown in the Hiring section instead
    const evidence = `Jobs (${provider}): mentioned in ${tool.count} engineering posting${tool.count > 1 ? "s" : ""}`;
    const source: EvidenceSource | null = boardUrl
      ? { label: `${tool.count} ${provider} posting${tool.count > 1 ? "s" : ""} mention ${tool.name}`, url: boardUrl, kind: "job" }
      : null;
    const existing = out.find((t) => t.name === tool.name);
    if (existing) {
      existing.confirmed = true;
      existing.evidence = [evidence, ...existing.evidence].slice(0, MAX_EVIDENCE);
      if (source) existing.sources = [source, ...existing.sources].slice(0, MAX_EVIDENCE);
    } else {
      out.push({ name: tool.name, category, evidence: [evidence], confirmed: true, sources: source ? [source] : [] });
    }
  }
  return out;
}
