import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";

/** Catalogue click-through: which asset was opened, from where. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { path, source, eventId } = await req.json().catch(() => ({}));
  // ref_event_id links an open to the answer it came from - the "engaged" metric's direct evidence.
  await logEvent({ user_id: user.id, kind: "catalogue_open", asset_path: String(path ?? ""), intent: String(source ?? "catalogue"),
    ref_event_id: Number.isInteger(eventId) ? eventId : null });
  return NextResponse.json({ ok: true });
}
