import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { eventId, feedback, query } = await req.json().catch(() => ({}));
  if (!["helpful", "wrong_asset", "missing"].includes(feedback)) return NextResponse.json({ error: "Unknown feedback value." }, { status: 400 });
  await logEvent({ user_id: user.id, kind: "feedback", feedback, ref_event_id: eventId ?? null, query: query ?? null });
  return NextResponse.json({ ok: true });
}
