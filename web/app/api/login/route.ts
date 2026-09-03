import { NextResponse } from "next/server";
import { login, usersConfigured } from "@/lib/auth";

export async function POST(req: Request) {
  if (!usersConfigured()) return NextResponse.json({ error: "No users configured. Set SAM_USERS on the server." }, { status: 503 });
  const { id, password } = await req.json().catch(() => ({}));
  if (!id || !password) return NextResponse.json({ error: "Enter your login ID and password." }, { status: 400 });
  const user = await login(String(id), String(password));
  if (!user) return NextResponse.json({ error: "That login ID and password don't match." }, { status: 401 });
  return NextResponse.json({ ok: true, user });
}
