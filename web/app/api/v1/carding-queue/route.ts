import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { cardingQueue } from "@/lib/sharepoint";

export const maxDuration = 30;

const REASONS = new Set(["uncarded", "changed_since_card", "renamed"]);

/** GET /api/v1/carding-queue[?reason=uncarded|changed_since_card|renamed]
 *
 *  The carding to-do list: active, ingestable SharePoint files with no card, a card older than the
 *  file, or a card whose file was renamed. Read from the sam_carding_queue view. */
export async function GET(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const reason = new URL(req.url).searchParams.get("reason") ?? undefined;
  if (reason && !REASONS.has(reason)) return Response.json({ error: `reason must be one of ${[...REASONS].join(", ")}` }, { status: 400 });
  const items = await cardingQueue(reason);
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.reason] = (counts[i.reason] ?? 0) + 1;
  return Response.json({ total: items.length, counts, items });
}
