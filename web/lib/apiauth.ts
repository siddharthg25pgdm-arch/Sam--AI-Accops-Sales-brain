import { currentUser, verifyToken, type User } from "./auth";

/** Machine callers (Dwight extension, scripts, MCP clients) authenticate with a bearer token.
 *  SAM_API_TOKENS="dwight-siddharth:tok_abc...,dwight-rahul:tok_def..."  → user_id is the label before the colon.
 *  Browser callers keep using the session cookie. Either works on every /api/v1 route.
 *  A SAM session JWT sent as a bearer (the SAM Live desktop app) is the cookie in another header. */
export type Caller = { id: string; admin: boolean; via: "token" | "cookie" };

function tokens(): Map<string, string> {
  const m = new Map<string, string>();
  for (const entry of (process.env.SAM_API_TOKENS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const i = entry.indexOf(":");
    if (i > 0) m.set(entry.slice(i + 1), entry.slice(0, i));
  }
  return m;
}

export function callerFromToken(header: string | null): Caller | null {
  const t = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!t) return null;
  const id = tokens().get(t);
  return id ? { id, admin: false, via: "token" } : null;
}

export async function resolveCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get("authorization");
  const fromToken = callerFromToken(header);
  if (fromToken) return fromToken;
  // via "cookie" on purpose: a rep's desktop token gets exactly the cookie's rights, so every
  // `via === "cookie" && !admin` gate still holds and it never gains machine-token privileges.
  const jwt = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const fromJwt = jwt ? await verifyToken(jwt) : null;
  if (fromJwt) return { ...fromJwt, via: "cookie" };
  const u: User | null = await currentUser();
  return u ? { id: u.id, admin: u.admin, via: "cookie" } : null;
}

export function unauthorized() {
  return Response.json({ error: "Sign in, or send Authorization: Bearer <token>." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
}
