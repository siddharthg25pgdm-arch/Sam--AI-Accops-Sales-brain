/** WhatsApp channel over Meta's WhatsApp Business Cloud API. No server session, no phone to keep alive:
 *  Meta posts webhooks to /api/channels/whatsapp and we reply through the Graph API.
 *
 *  Env:
 *    WHATSAPP_VERIFY_TOKEN     any string; paste the same value in the Meta webhook config
 *    WHATSAPP_APP_SECRET       Meta app secret, used to verify X-Hub-Signature-256 on every webhook
 *    WHATSAPP_ACCESS_TOKEN     permanent system-user token with whatsapp_business_messaging
 *    WHATSAPP_PHONE_NUMBER_ID  the sender number's ID from the Meta dashboard
 *    SAM_WHATSAPP_USERS        "919876543210:siddharth,919812345678:rahul"  (digits only, country code, no +)
 *  Without WHATSAPP_ACCESS_TOKEN the channel runs in dry-run mode: replies are logged, not sent. */
import crypto from "node:crypto";
import { apiAsk } from "./api";
import { logEvent } from "./events";

const GRAPH = "https://graph.facebook.com/v21.0";

export type InboundText = { id: string; from: string; text: string; name?: string; timestamp: string };

export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // allow unsigned only outside production
  const sig = header?.replace(/^sha256=/, "");
  if (!sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

/** Pull text messages out of Meta's webhook envelope. Ignores statuses, media, reactions. */
export function extractTexts(payload: unknown): InboundText[] {
  const out: InboundText[] = [];
  const p = payload as { entry?: { changes?: { value?: { messages?: Record<string, unknown>[]; contacts?: { wa_id: string; profile?: { name?: string } }[] } }[] }[] };
  for (const e of p.entry ?? []) for (const c of e.changes ?? []) {
    const v = c.value ?? {}; const names = new Map((v.contacts ?? []).map(x => [x.wa_id, x.profile?.name]));
    for (const m of v.messages ?? []) {
      if (m.type !== "text") continue;
      const text = (m.text as { body?: string } | undefined)?.body ?? "";
      if (!text.trim()) continue;
      out.push({ id: String(m.id), from: String(m.from), text: text.trim(), name: names.get(String(m.from)), timestamp: String(m.timestamp ?? "") });
    }
  }
  return out;
}

export function userForNumber(waId: string): string | null {
  for (const entry of (process.env.SAM_WHATSAPP_USERS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const [num, id] = entry.split(":");
    if (num?.replace(/\D/g, "") === waId.replace(/\D/g, "") && id) return id;
  }
  return null;
}

// Per-number short memory so follow-ups work, and a seen-set so Meta's retries don't double-answer.
type Turn = { role: "user" | "assistant"; content: string; at: number };
const g = globalThis as unknown as { __waHist?: Map<string, Turn[]>; __waSeen?: Set<string> };
const hist: Map<string, Turn[]> = (g.__waHist ??= new Map<string, Turn[]>()); const seen: Set<string> = (g.__waSeen ??= new Set<string>());
const TTL = 6 * 60 * 60 * 1000;

export function alreadySeen(id: string): boolean {
  if (seen.has(id)) return true;
  seen.add(id); if (seen.size > 5000) seen.clear();
  return false;
}

export async function sendText(to: string, body: string): Promise<{ sent: boolean; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const text = body.length > 4000 ? body.slice(0, 3990) + "…" : body;
  if (!token || !phoneId) { console.log(`[whatsapp dry-run] to=${to}\n${text}`); return { sent: false, error: "dry-run: WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set" }; }
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("whatsapp send failed", r.status, JSON.stringify(j).slice(0, 300)); return { sent: false, error: `graph ${r.status}` }; }
  return { sent: true, id: j.messages?.[0]?.id };
}

export async function markRead(messageId: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return;
  await fetch(`${GRAPH}/${phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }) }).catch(() => {});
}

/** Render SAM's answer for a phone: verdict, then at most three assets, public links first, private links marked. */
export function renderForWhatsApp(answer: string, assets: { title: string; link: string | null; visibility: string; why: string; year: string | null }[], gap: boolean): string {
  const lines = [answer.trim()];
  const ordered = [...assets].sort((a, b) => Number(b.visibility === "public") - Number(a.visibility === "public")).slice(0, 3);
  ordered.forEach((a, i) => {
    const vis = a.visibility === "public" ? "public link" : "internal only, login needed";
    lines.push(`\n${i + 1}. *${a.title}*${a.year ? ` (${a.year})` : ""}\n${a.why}\n${vis}: ${a.link ?? "no link"}`);
  });
  if (ordered.length && ordered.every(a => a.visibility !== "public")) lines.push("\nNone of these has a public version. Don't forward the links outside Accops; ask marketing to publish first.");
  if (gap) lines.push("\nLogged as a content gap for marketing.");
  lines.push("\nReply with an industry, product or competitor to narrow it.");
  return lines.join("\n");
}

/** Full handling of one inbound text: identity, ask, reply, log. Safe to run after the HTTP response. */
export async function handleInbound(m: InboundText): Promise<void> {
  if (alreadySeen(m.id)) return;
  const user = userForNumber(m.from);
  await markRead(m.id);
  if (!user) {
    await logEvent({ user_id: `wa:${m.from}`, channel: "whatsapp", kind: "query", query: m.text, intent: "unregistered", result_count: 0, runtime: "none" });
    await sendText(m.from, "This number isn't registered with SAM yet. Ask Siddharth to add it, then try again.");
    return;
  }
  const h = (hist.get(m.from) ?? []).filter(x => Date.now() - x.at < TTL);
  const history = h.map(({ role, content }) => ({ role, content }));
  const r = await apiAsk(m.text, user, "whatsapp", history);
  const body = renderForWhatsApp(r.answer, r.assets, r.gap);
  h.push({ role: "user", content: m.text, at: Date.now() }, { role: "assistant", content: r.answer, at: Date.now() });
  hist.set(m.from, h.slice(-8));
  await sendText(m.from, body);
}
