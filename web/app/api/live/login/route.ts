import { authenticate, issueToken, usersConfigured } from "@/lib/auth";

/** POST /api/live/login {id, password} -> {token, user:{id, admin}}: the SAM Live desktop app's sign-in.
 *  The token is a 30-day SAM session JWT, sent back as Authorization: Bearer. It carries exactly the
 *  browser session's rights (lib/apiauth.ts), not an API token's. */
export async function POST(req: Request) {
  if (!usersConfigured()) return Response.json({ error: "No users configured. Set SAM_USERS on the server." }, { status: 503 });
  const b = await req.json().catch(() => null);
  if (!b?.id || !b?.password) return Response.json({ error: "Enter your login ID and password." }, { status: 400 });
  const user = authenticate(String(b.id), String(b.password));
  if (!user) return Response.json({ error: "That login ID and password don't match." }, { status: 401 });
  return Response.json({ token: await issueToken(user), user });
}
