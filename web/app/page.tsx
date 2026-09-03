import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { allAssets, slim, facetCounts, coverageGaps } from "@/lib/cards";
import { recentEvents } from "@/lib/events";
import { TopBar } from "@/components/TopBar";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const assets = allAssets().map(slim);
  const facets = facetCounts();
  // Gaps that real people have asked about rank first in "Not available".
  const events = await recentEvents(500);
  const askedGaps = events.filter(e => e.kind === "gap");
  const gaps = coverageGaps().map(g => {
    const asked = askedGaps.filter(e => {
      const f = (e.filters ?? {}) as Record<string, string>;
      return (f.vertical ?? "").toLowerCase() === g.vertical.toLowerCase() && (!g.product || (f.product ?? "").toLowerCase() === g.product.toLowerCase());
    }).length;
    return { ...g, asked };
  }).sort((a, b) => (b.asked ?? 0) - (a.asked ?? 0));
  return (
    <>
      <TopBar user={user} current="home" />
      <Shell assets={assets} facets={facets} gaps={gaps} hasModel={Boolean(process.env.ANTHROPIC_API_KEY)} />
    </>
  );
}
