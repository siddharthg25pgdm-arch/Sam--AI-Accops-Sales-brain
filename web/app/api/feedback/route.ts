import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";
import { askedEvent } from "@/lib/feedback";
import { fileFromRating, retractRating } from "@/lib/requests";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { eventId, feedback, query } = await req.json().catch(() => ({}));
  if (!["helpful", "wrong_asset", "missing"].includes(feedback)) return NextResponse.json({ error: "Unknown feedback value." }, { status: 400 });
  const ref = Number.isInteger(eventId) ? eventId : null;
  await logEvent({ user_id: user.id, kind: "feedback", feedback, ref_event_id: ref, query: query ?? null });
  // "Doesn't exist" is demand: it votes on the content request for the question it rated. Any other
  // rating takes that vote back (the latest rating is what the rep meant). Only the rep's own question.
  const asked = ref ? await askedEvent(ref, user.id) : null;
  if (asked && ref) {
    if (feedback !== "missing") await retractRating(ref, user.id);
    else if (asked.query) {
      const r = await fileFromRating(asked.query, ref, user.id);
      if (r.ok) return NextResponse.json({ ok: true, request: { id: r.id, title: r.title, demand: r.demand } });
    }
  }
  return NextResponse.json({ ok: true });
}
