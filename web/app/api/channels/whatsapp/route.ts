import { after } from "next/server";
import { extractTexts, handleInbound, verifySignature } from "@/lib/whatsapp";

export const maxDuration = 60;

/** Meta webhook verification handshake (set once in the Meta dashboard). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode"), token = u.searchParams.get("hub.verify_token"), challenge = u.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) return new Response(challenge, { status: 200 });
  return new Response("verification failed", { status: 403 });
}

/** Inbound messages. Acknowledge fast, answer after the response so Meta never times out. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("bad signature", { status: 401 });
  let payload: unknown; try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const texts = extractTexts(payload);
  after(async () => { for (const m of texts) { try { await handleInbound(m); } catch (e) { console.error("whatsapp handle failed", e); } } });
  return Response.json({ ok: true, received: texts.length });
}
