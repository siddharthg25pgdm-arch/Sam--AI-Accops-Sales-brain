/** Plan 2.3: every ask is labelled human / suspect / bot. Bots and suspects never reach the model (answer.ts gates
 *  tier 3 on `human`). A label only escalates: each signal can only raise it, and sam_web_log_message keeps the
 *  conversation's highest label. Cheap local signals first; Vercel BotID (Basic, free) last. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { checkBotId } from "botid/server";
import type { Classify, Label } from "./contracts";

export const BOT_UA = /bot|crawl|spider|slurp|headless|python-requests|curl|wget|httpclient|go-http|java\//i;
const HS_MIN_MS = 1_000, HS_MAX_MS = 2 * 3600_000;

const mac = (conv: string, issued: number) =>
  createHmac("sha256", process.env.WEB_HS_SECRET ?? "").update(`${conv}.${issued}`).digest("base64url");

/** The handshake /embed server-renders: `conv.issued_ms.mac`. Stream D's page imports this, so mint and verify agree. */
export function mintHs(conversation_id: string, issued = Date.now()) {
  if (!process.env.WEB_HS_SECRET) throw new Error("WEB_HS_SECRET is not set");
  return `${conversation_id}.${issued}.${mac(conversation_id, issued)}`;
}

/** The token's age in ms, or a reason it is bad. Parsed from the right: conversation ids may contain dots. */
export function verifyHs(hs: string | null, conversation_id: string, now = Date.now()): { age: number } | { bad: string } {
  if (!process.env.WEB_HS_SECRET) return { bad: "hs_unconfigured" }; // fail safe: nothing verifies without the secret
  if (!hs) return { bad: "hs_missing" };
  const parts = hs.split("."), sig = parts.pop() ?? "", issued = Number(parts.pop()), conv = parts.join(".");
  const want = Buffer.from(mac(conv, issued)), got = Buffer.from(sig);
  if (!Number.isSafeInteger(issued) || want.length !== got.length || !timingSafeEqual(want, got)) return { bad: "hs_forged" };
  if (conv !== conversation_id) return { bad: "hs_other_conversation" };
  const age = now - issued;
  return age < HS_MIN_MS || age > HS_MAX_MS ? { bad: "hs_expired" } : { age };
}

/** A test conversation: /embed mints a "t_" id only when SAM frames itself for an admin (page.tsx). The id is inside
 *  the handshake MAC, so a client cannot forge one; only the signature matters here, not the token's age. */
export function isTestConv(hs: string | null, conversation_id: string) {
  if (!conversation_id.startsWith("t_")) return false;
  const v = verifyHs(hs, conversation_id);
  return !("bad" in v) || v.bad === "hs_expired";
}

/** Typed sends: 4+ under 1.5 s apart, or near-identical spacing (sd < 100 ms). recent_ms holds the last <= 6 sends. */
export function cadence(recent: number[]): string | null {
  const gaps = recent.slice(1).map((t, i) => t - recent[i]);
  if (gaps.some(g => g < 0)) return "cadence_unordered";
  if (gaps.length < 3) return null;
  if (gaps.every(g => g < 1500)) return "cadence_fast";
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  return sd < 100 ? "cadence_regular" : null;
}

export const classify: Classify = async (req, ctx) => {
  if (ctx.eval) return { label: "human", signals: ["eval"] }; // E's eval: valid x-sam-eval token (checked in answer.ts)
  const bot: string[] = [], suspect: string[] = [];

  if (!ctx.ua || BOT_UA.test(ctx.ua)) bot.push("ua");
  const o = req.headers.get("origin");
  if (!o || !URL.canParse(o) || new URL(o).host !== new URL(req.url).host) bot.push("origin"); // answer.ts already 403s these
  const hs = verifyHs(ctx.hs, ctx.conversation_id);
  if ("bad" in hs) bot.push(hs.bad);
  else if (ctx.ms_since_render > hs.age + 2000) suspect.push("render_clock"); // claims a render before the token existed

  if (!ctx.parent) suspect.push("no_parent"); // /embed opened directly, never got an origin-checked init
  // A chip click can land fast (300 ms); typing a question and sending it under 2 s after render is not a person.
  if (ctx.ms_since_render < (ctx.kind === "typed" ? 2000 : 300)) suspect.push("too_fast");
  const c = cadence(ctx.recent_ms);
  if (c) suspect.push(c);

  // BotID last (one network-free header check on Vercel; always `isBot: false` in local dev).
  // ponytail: if BotID misbehaves inside the cross-site iframe (plan risk 11), it degrades to suspect, never human.
  try {
    const v = await checkBotId();
    if (v.isBot || v.isVerifiedBot) bot.push(v.isVerifiedBot ? "botid_verified_bot" : "botid");
  } catch { suspect.push("botid_error"); }

  // TODO(web-s1 contract notes, "labels are not sticky across turns"): this labels one turn only. A bot or suspect
  // conversation's next clean-looking turn is human again (the log keeps the highest label, but nothing reads it back
  // here). Needs a Stream A read RPC for the conversation's highest label; escalate to it before returning.
  const label: Label = bot.length ? "bot" : suspect.length ? "suspect" : "human";
  return { label, signals: [...bot, ...suspect] };
};
