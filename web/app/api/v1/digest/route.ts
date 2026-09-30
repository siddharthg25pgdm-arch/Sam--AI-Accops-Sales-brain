import crypto from "node:crypto";
import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { buildDigest, renderHtml } from "@/lib/digest";
import { recentEvents, realOnly, testUsers } from "@/lib/events";
import { usageWindow } from "@/lib/metrics";
import { listRequests, unrequestedGaps, ACTIVE, type Status } from "@/lib/requests";
import { cardedSince, cardingQueue, changedSince, familyRows, lastFlowWrite, syncStatus } from "@/lib/sharepoint";
import { cardsReady, cardCacheState } from "@/lib/cards-cache";
import { loadRatings } from "@/lib/feedback";
import { jobHealth, jobStates, logRun, recentRuns } from "@/lib/ops";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ALL: Status[] = ["open", "planned", "in_progress", "done", "declined", "merged"];

/** The shared secret the Power Automate flows already carry (SP_WEBHOOK_SECRET), compared in
 *  constant time. Hashing first makes the lengths equal, so the length is not leaked either. */
/** When the WhatsApp token expires, from Meta's debug_token (the token inspects itself). Omitted when
 *  WhatsApp isn't configured. A failed lookup is not an alarm: Meta being slow is not SAM being broken. */
async function whatsappToken(): Promise<{ valid: boolean; expiresAt: string | null } | undefined> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return undefined;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const d = (await r.json())?.data;
    if (!d) return undefined;
    const exp = Number(d.expires_at ?? 0);
    return { valid: d.is_valid === true, expiresAt: exp > 0 ? new Date(exp * 1000).toISOString() : null };
  } catch { return undefined; }
}

function secretOk(header: string | null): boolean {
  const expected = process.env.SP_WEBHOOK_SECRET;
  const got = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!expected || !got) return false;
  const h = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(got), h(expected));
}

/** GET /api/v1/digest[?format=json]
 *
 *  The morning digest for the owner of the content-request queue: email-safe HTML by default, the
 *  same data as JSON with ?format=json. The subject is in X-SAM-Subject (and `subject` in JSON).
 *  Auth: a SAM API token or session, or Authorization: Bearer <SP_WEBHOOK_SECRET>. Read-only. */
export async function GET(req: Request) {
  if (!secretOk(req.headers.get("authorization")) && !(await resolveCaller(req))) return unauthorized();

  const now = new Date().toISOString();
  const t = Date.parse(now), since = new Date(t - 86_400_000).toISOString();
  const failed: string[] = [];
  // One failed read must not sink the email, and must not pass for an empty section either.
  const safe = async <T,>(label: string, p: Promise<T>): Promise<T | null> => {
    try { const v = await p; if (v == null) failed.push(label); return v; }
    catch (e) { console.error(`digest: ${label}`, e); failed.push(label); return null; }
  };

  const users = testUsers();
  const [all, gapEvents, changes, queue, carded, usage, usagePrev, flow, sync, , whatsapp, ratings, ops] = await Promise.all([
    safe("content requests", listRequests({ statuses: ALL })),
    safe("content gaps", recentEvents(1000, `kind=eq.gap&created_at=gte.${encodeURIComponent(new Date(t - 7 * 86_400_000).toISOString())}&${realOnly()}`)),
    safe("SharePoint changes", changedSince(since)),
    safe("carding queue", cardingQueue()),
    safe("new cards", cardedSince(since)),
    safe("usage", usageWindow(since, now, users)),
    safe("usage", usageWindow(new Date(t - 8 * 86_400_000).toISOString(), since, users)),
    lastFlowWrite().catch(() => { failed.push("SharePoint flow status"); return null; }),
    syncStatus().catch(() => { failed.push("deletion check status"); return null; }),
    cardsReady(),
    whatsappToken(),
    // ?test=1 lets the ratings section include test traffic, to check it end to end from local dev.
    safe("ratings", loadRatings({ from: since, real: new URL(req.url).searchParams.get("test") !== "1", limit: 500 })),
    safe("scheduled job log", recentRuns()),
  ]);

  // Families of what arrived: a new version of an existing document is reported apart from new content,
  // and a file carded as pre-2024 is reported as excluded from answers.
  const ids = [...new Set([...(changes ?? []).filter(f => !f.deleted && (f.created_at ?? "") >= since).map(f => f.item_id), ...(carded ?? []).map(c => c.item_id)].filter((x): x is string => Boolean(x)))];
  const families = ids.length ? await safe("document families", familyRows(ids)) : [];

  const d = buildDigest({
    now, base: new URL(req.url).origin,
    requests: all ? all.filter(r => ACTIVE.includes(r.status)) : null,
    gaps: all && gapEvents ? unrequestedGaps(gapEvents, all.map(r => r.topic_key)) : null,
    changes, queue, carded, usage, usagePrev, lastFlowWrite: flow, sync,
    cardCount: cardCacheState().count, failed: [...new Set(failed)], whatsapp, ratings, families,
    // The digest itself is running, so it is left out of its own job check.
    jobs: ops ? jobHealth(jobStates(ops.runs, now, ops.since).filter(j => j.job !== "digest")) : null,
  });

  // One run per fetch: the Power Automate flow calls this once a morning, so its absence is visible.
  const url = new URL(req.url);
  if (url.searchParams.get("test") !== "1") await logRun({ job: "digest", started_at: now, status: d.health.length ? "warn" : "ok", summary: d.subject,
    details: { format: url.searchParams.get("format") ?? "html", health: d.health.map(h => h.title), failed: [...new Set(failed)] } });

  const headers = { "Cache-Control": "no-store", "X-SAM-Subject": d.subject };
  if (new URL(req.url).searchParams.get("format") === "json") return Response.json(d, { headers });
  return new Response(renderHtml(d), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
