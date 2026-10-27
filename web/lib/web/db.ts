/** PostgREST as `sam_web_reader` (plan 2.1, 5). The website's only door to the database: the reader JWT +
 *  the publishable key, never the service key. Reads go through the public views and read RPCs;
 *  writes only through the write RPCs (no table grants). Nothing here is reachable until Stream A's
 *  migrations are applied and WEB_CHAT_ENABLED=1: until then every /api/web/* route answers 503. */
import { cleanKey, redact } from "@/lib/redact";
import type { Candidate } from "./contracts";

function cfg() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const jwt = cleanKey(process.env.SAM_WEB_READER_JWT, "SAM_WEB_READER_JWT").key;
  const apikey = cleanKey(process.env.SAM_WEB_SUPABASE_APIKEY, "SAM_WEB_SUPABASE_APIKEY").key;
  return url && jwt && apikey ? { url, jwt, apikey } : null;
}

/** The website is off unless the flag is on and the reader's env exists (plus the IP salt the ask route needs). */
export const webReady = () => process.env.WEB_CHAT_ENABLED === "1" && !!cfg() && !!process.env.WEB_IP_SALT;

async function rest<T>(path: string, body?: unknown): Promise<T> {
  const c = cfg();
  if (!c) throw new Error("web db not configured");
  const r = await fetch(`${c.url}/rest/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: c.apikey, Authorization: `Bearer ${c.jwt}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  // A missing view or function (migrations not applied) is a 404 here; the routes turn any error into 503 or a fallback.
  if (!r.ok) throw new Error(redact(`${path.split("?")[0]} returned ${r.status}: ${(await r.text()).slice(0, 200)}`));
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}
export const rpc = <T>(fn: string, args: Record<string, unknown> = {}) => rest<T>(`rpc/${fn}`, args);

/** booking_url: the Bookings calendar the chat opens in its panel (05 SQL; "" or missing = the old new-tab CTA). */
export type Settings = { enabled: boolean; model_enabled: boolean; cta_url: string; cta_label: string; booking_url?: string };
export type Qa = { id: string; question: string; answer: string; visual: string | null; visual_data: Record<string, unknown> | null;
  cta: string | null; cta_url: string | null; sources: string[] | null };
export type QaRef = { id: string; question: string };

/** ponytail: no reader grant on sam_web_settings, so a definer RPC returns the public subset (contract ask for Stream A). */
export const settings = () => rpc<Settings>("sam_web_settings");
export const pageGroup = async (url: string) => (await rpc<string | null>("sam_web_page_group", { url })) || "general";
export const roots = (page_url: string) => rpc<QaRef[]>("sam_web_roots", { page_url });
export const children = (qa_id: string) => rpc<QaRef[]>("sam_web_children", { qa_id });
export const search = (q: string, page_group: string, k = 12) => rpc<Candidate[]>("sam_web_search", { q, page_group, k });
export const takeModelSlot = (provider: "openai" | "groq") => rpc<boolean>("sam_web_take_model_slot", { provider });
export const logMessage = (m: Record<string, unknown>) => rpc<null>("sam_web_log_message", { m });
export const logEvent = (e: Record<string, unknown>) => rpc<null>("sam_web_log_event", { e });

/** Every approved pair, light columns: page-aware suggestions rank them in TS (suggest.ts). */
export type QaLite = { id: string; question: string; sources: string[] | null; pages: string[] | null; nudge_weight: number | null };
export const pairs = () => rest<QaLite[]>("sam_web_qa_public?select=id,question,sources,pages,nudge_weight");
export type PageCard = { url: string; title: string; page_type: string | null; products: string[] | null; industries: string[] | null; questions_answered: string[] | null };
/** The public cards for these exact URLs. The caller builds them from new URL() (no raw quotes) + an allowlisted section. */
export const pageCards = (urls: string[]) => rest<PageCard[]>(`sam_web_pages_public?select=url,title,page_type,products,industries,questions_answered&url=in.${
  encodeURIComponent(`(${urls.map(u => `"${u}"`).join(",")})`)}`);

/** Welcome-back memory (07 SQL): up to 3 approved pairs this device asked or clicked and the last public page it read
 *  (other than not_page), within 90 days; null for an unknown id or nothing to recall. */
export type Recall = { last_qa: QaRef[]; last_page: { url: string; title: string } | null; last_seen: string } | null;
export const recall = (visitor_id: string, not_page: string) => rpc<Recall>("sam_web_recall", { visitor_id, not_page });

/** Approved pairs only (the view filters status/review); ids are validated by the caller (no quotes or commas). */
export async function qas(ids: string[]): Promise<Map<string, Qa>> {
  if (!ids.length) return new Map();
  const rows = await rest<Qa[]>(`sam_web_qa_public?select=id,question,answer,visual,visual_data,cta,cta_url,sources&id=in.${
    encodeURIComponent(`(${ids.map(i => `"${i}"`).join(",")})`)}`);
  return new Map(rows.map(r => [r.id, r]));
}
