/** Analytics events. Writes to Supabase (table sam_events, see docs/supabase-sam-events.sql and
 * docs/supabase-sam-observability.sql) through the service-role key, server side only. Without
 * SUPABASE_URL + SUPABASE_SERVICE_KEY it keeps an in-memory buffer so the dashboard still works within
 * one server instance (lost on cold start; the UI says so).
 *
 * No imports on purpose: lib/metrics.check.mjs runs this file under bare node. */

/** The error taxonomy. One value per question: the worst thing that happened while answering it.
 *  A content gap is deliberately NOT here - that is the library lacking something, not SAM failing. */
export const ERROR_KINDS = {
  server_error: "The route threw. The person got an error, not an answer.",
  timeout: "A model call hit the deadline. Answered from retrieval instead.",
  fallback_retrieval: "Every configured model failed. Answered from retrieval instead.",
  provider_error: "One model provider failed and another answered. Invisible to the person.",
  step_exhausted: "The model used every tool step without writing an answer.",
  empty_answer: "The model finished without writing any text.",
} as const;
export type ErrorKind = keyof typeof ERROR_KINDS;
export type AskError = { kind: ErrorKind; detail: string };

/** Classify the provider failures behind one answer. `answeredByModel` is whether some model still
 *  produced the final reply. Timeouts are called out on their own because the fix is different
 *  (a slower model or a tighter prompt) from an outage or a bad key. */
export function providerFailure(failures: { model: string; message: string; timeout: boolean }[], answeredByModel: boolean): AskError | null {
  if (!failures.length) return null;
  const detail = failures.map(f => `${f.model}: ${f.message}`).join(" | ").slice(0, 500);
  if (answeredByModel) return { kind: "provider_error", detail };
  return { kind: failures.some(f => f.timeout) ? "timeout" : "fallback_retrieval", detail };
}

export type SamEvent = {
  id?: number; created_at?: string; user_id: string; channel?: string; session_id?: string | null;
  kind: "query" | "feedback" | "catalogue_open" | "gap" | "request";
  query?: string | null; intent?: string | null; filters?: Record<string, unknown> | null;
  result_count?: number | null; result_ids?: string[] | null; runtime?: string | null; latency_ms?: number | null;
  feedback?: "helpful" | "wrong_asset" | "missing" | null; ref_event_id?: number | null; asset_path?: string | null;
  is_test?: boolean; error_kind?: ErrorKind | null; error_detail?: string | null; model?: string | null;
  answer?: string | null; result_titles?: string[] | null; schema_version?: number | null;
};

/** Identities whose traffic is test, not use. Applied at write time (is_test) AND at read time
 *  (the dashboard passes the list to sam_dashboard), so reclassifying an identity later needs an env
 *  change rather than a data fix. dwight-test is the eval harness; dwight-siddharth is the API token
 *  that, as of 25 Sep 2026, had only been used for testing (agents were still calling it that day).
 *  If the Dwight extension goes into real use under that token, set SAM_TEST_USERS=dwight-test. */
export function testUsers(): string[] {
  return (process.env.SAM_TEST_USERS ?? "dwight-test,dwight-siddharth").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** PostgREST filter for real traffic only - the read-time half of the rule above. */
export function realOnly(): string {
  const u = testUsers();
  return `is_test=is.false${u.length ? `&user_id=not.in.(${u.map(x => `"${encodeURIComponent(x)}"`).join(",")})` : ""}`;
}

/** Test if: the caller says so (x-sam-test: 1), the identity is a known test identity, or the event
 *  came from `next dev` - local development writes to the production tables, and nothing typed into
 *  localhost is real use. */
async function isTest(e: SamEvent): Promise<boolean> {
  if (e.is_test) return true;
  if (process.env.NODE_ENV === "development") return true;
  if (testUsers().includes(e.user_id.toLowerCase())) return true;
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("x-sam-test") === "1";
  } catch { return false; } // outside a request (cron, script): no header to read
}

/** The same rule for things that are not events: a content request from local dev or a test identity
 *  is a test request, and never reaches marketing's queue. */
export function testTraffic(user_id: string): Promise<boolean> {
  return isTest({ user_id, kind: "request" });
}

// One buffer per process, not per route bundle: Next.js gives each route its own module instance,
// so a plain module-level array would make /admin blind to what /api/ask recorded.
const g = globalThis as unknown as { __samMem?: SamEvent[]; __samMemId?: number };
const mem: SamEvent[] = (g.__samMem ??= []);
let memId = g.__samMemId ?? 1;

function cfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
export function persistent() { return Boolean(cfg()); }

/** Never throws: analytics must not break an answer. */
export async function logEvent(e: SamEvent): Promise<number | null> {
  const row: SamEvent = {
    ...e, channel: e.channel ?? "web", is_test: await isTest(e), schema_version: 2,
    answer: e.answer?.slice(0, 2000) ?? e.answer, error_detail: e.error_detail?.slice(0, 500) ?? e.error_detail,
  };
  const c = cfg();
  if (!c) { const m = { ...row, id: memId++, created_at: new Date().toISOString() }; g.__samMemId = memId; mem.unshift(m); if (mem.length > 2000) mem.pop(); return m.id!; }
  try {
    const r = await fetch(`${c.url}/rest/v1/sam_events`, {
      method: "POST", headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) { console.error("sam_events insert failed", r.status, await r.text()); return null; }
    const [out] = await r.json(); return out?.id ?? null;
  } catch (err) { console.error("sam_events insert error", err); return null; }
}

/** Raw rows, newest first, for the few things that are inherently row-level. `query` is a PostgREST
 *  filter string (e.g. "kind=eq.gap&is_test=is.false"). The in-memory fallback ignores it. */
export async function recentEvents(limit = 1000, query = ""): Promise<SamEvent[]> {
  const c = cfg();
  if (!c) return mem.slice(0, limit);
  try {
    const r = await fetch(`${c.url}/rest/v1/sam_events?select=*&order=created_at.desc&limit=${limit}${query ? `&${query}` : ""}`, {
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}` }, cache: "no-store",
    });
    if (!r.ok) { console.error("sam_events read failed", r.status); return []; }
    return await r.json();
  } catch (err) { console.error("sam_events read error", err); return []; }
}
