import { Suspense } from "react";
import { connection } from "next/server";
import { Dashboard } from "@/components/dashboard";
import { loadWatchlist } from "@/lib/api";

/**
 * The watchlist is rendered on the server, so the very first HTML already
 * contains every account, summary and opener (no empty "syncing…" shell for
 * crawlers, reviewers or slow connections). The client then keeps it live.
 */
export default function Home() {
  return (
    <Suspense fallback={<Dashboard initialCompanies={null} />}>
      <WatchlistDashboard />
    </Suspense>
  );
}

async function WatchlistDashboard() {
  await connection();
  const companies = await loadWatchlist().catch((err) => {
    console.error("[page] server-side watchlist load failed; client will retry:", err);
    return null;
  });
  return <Dashboard initialCompanies={companies} />;
}
