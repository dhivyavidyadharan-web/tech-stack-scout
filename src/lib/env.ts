import "server-only";

/** Centralised, lazily-validated environment access (server only). */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See README.md → Environment variables.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Optional: without it, summaries fall back to a deterministic template. */
  geminiApiKey: () => process.env.GEMINI_API_KEY || null,
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-flash-latest",
  /** Optional: without it, GitHub allows only 60 requests/hour. */
  githubToken: () => process.env.GITHUB_TOKEN || null,
  cronSecret: () => process.env.CRON_SECRET || null,
  /** What the AE is selling — shapes every outreach line. */
  sellerProduct: () =>
    process.env.SELLER_PRODUCT_DESCRIPTION ||
    "a developer productivity platform that cuts CI build times, speeds up code review and reduces context-switching for engineering teams",
};
