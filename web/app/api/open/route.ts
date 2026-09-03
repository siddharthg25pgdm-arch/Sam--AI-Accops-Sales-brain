import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";

/** Catalogue click-through: which asset was opened, from where. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { path, source } = await req.json().catch(() => ({}));
  await logEvent({ user_id: user.id, kind: "catalogue_open", asset_path: String(path ?? ""), intent: String(source ?? "catalogue") });
  return NextResponse.json({ ok: true });
}
