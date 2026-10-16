import { searchRoute } from "@/lib/passages";

/** GET /api/v1/passages?q=...&k=8&audience=internal|external   and   POST /api/v1/passages {query, k, audience, filters}
 *  Passage text of carded documents, ranked, with doc id/version, page/slide/section, links, audience, sharing
 *  approval and freshness. Internal passages need a token with the passages:internal scope. Contract:
 *  docs/SALES-BRAIN-PLATFORM.md, "Passages". Header x-sam-on-behalf-of: <user> is logged. */
export async function GET(req: Request) { return searchRoute(req); }
export async function POST(req: Request) { return searchRoute(req); }
