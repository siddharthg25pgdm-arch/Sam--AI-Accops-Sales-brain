/** Analytics events. Writes to Supabase (table sam_events, see docs/supabase-sam-events.sql) through the
 * service-role key, server side only. Without SUPABASE_URL + SUPABASE_SERVICE_KEY it keeps an in-memory
 * buffer so the dashboard still works within one server instance (lost on cold start; the UI says so). */

export type SamEvent = {
  id?: number; created_at?: string; user_id: string; channel?: string; session_id?: string | null;
  kind: "query" | "feedback" | "catalogue_open" | "gap";
  query?: string | null; intent?: string | null; filters?: Record<string, unknown> | null;
  result_count?: number | null; result_ids?: string[] | null; runtime?: string | null; latency_ms?: number | null;
  feedback?: "helpful" | "wrong_asset" | "missing" | null; ref_event_id?: number | null; asset_path?: string | null;
};

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

export async function logEvent(e: SamEvent): Promise<number | null> {
  const c = cfg();
  if (!c) { const row = { ...e, id: memId++, created_at: new Date().toISOString(), channel: e.channel ?? "web" }; g.__samMemId = memId; mem.unshift(row); if (mem.length > 2000) mem.pop(); return row.id!; }
  try {
    const r = await fetch(`${c.url}/rest/v1/sam_events`, {
      method: "POST", headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ ...e, channel: e.channel ?? "web" }),
    });
    if (!r.ok) { console.error("sam_events insert failed", r.status, await r.text()); return null; }
    const [row] = await r.json(); return row?.id ?? null;
  } catch (err) { console.error("sam_events insert error", err); return null; }
}

export async function recentEvents(limit = 1000): Promise<SamEvent[]> {
  const c = cfg();
  if (!c) return mem.slice(0, limit);
  try {
    const r = await fetch(`${c.url}/rest/v1/sam_events?select=*&order=created_at.desc&limit=${limit}`, {
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}` }, cache: "no-store",
    });
    if (!r.ok) { console.error("sam_events read failed", r.status); return []; }
    return await r.json();
  } catch (err) { console.error("sam_events read error", err); return []; }
}
