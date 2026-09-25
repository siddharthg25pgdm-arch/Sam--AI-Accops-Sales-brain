import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { markSeen } from "@/lib/requests";

/** The rep dismissed the "delivered" notice. Only ever touches their own votes. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { ids } = await req.json().catch(() => ({}));
  await markSeen(user.id, Array.isArray(ids) ? ids.map(Number) : []);
  return NextResponse.json({ ok: true });
}
