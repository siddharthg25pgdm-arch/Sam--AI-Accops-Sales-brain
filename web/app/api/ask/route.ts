import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ask } from "@/lib/agent";
import { logEvent } from "@/lib/events";
import { ready } from "@/lib/registry-cache";

export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "Ask something." }, { status: 400 });
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  // Block only on a cold start. After that the cache is warm and this returns immediately, so the
  // first question of a session still searches the full registry rather than the 77 cards alone.
  await ready();
  const t0 = Date.now();
  const result = await ask(question, history);
  const eventId = await logEvent({
    user_id: user.id, session_id: body.sessionId ?? null, kind: "query", query: question, intent: result.intent,
    filters: result.filters, result_count: result.assets.length, result_ids: result.assets.map(a => a.path ?? a.title),
    runtime: result.runtime, latency_ms: Date.now() - t0,
  });
  if (result.zero) await logEvent({ user_id: user.id, session_id: body.sessionId ?? null, kind: "gap", query: question, filters: result.filters, ref_event_id: eventId });
  return NextResponse.json({ ...result, eventId });
}
