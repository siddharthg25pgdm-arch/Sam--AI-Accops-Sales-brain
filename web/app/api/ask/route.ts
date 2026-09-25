import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { askAndLog } from "@/lib/api";
import { ready } from "@/lib/registry-cache";
import { suggestTitle } from "@/lib/requests";

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
  try {
    const { r, eventId } = await askAndLog(question, user.id, "web", history, body.sessionId ?? null);
    // requestTitle prefills "Ask marketing to create this", on a missing answer or from "doesn't exist".
    return NextResponse.json({ ...r, eventId, requestTitle: suggestTitle(question) });
  } catch {
    // Already logged as a server_error question by askAndLog.
    return NextResponse.json({ error: "something went wrong on the server, and it has been logged" }, { status: 500 });
  }
}
