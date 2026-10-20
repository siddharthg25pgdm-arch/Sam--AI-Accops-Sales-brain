import { currentUser, verifyToken, type User } from "./auth";

/** Machine callers (Dwight extension, scripts, MCP clients) authenticate with a bearer token.
 *  SAM_API_TOKENS="dwight-siddharth:tok_abc...,sam-live:tok_def...:passages:internal"  → user_id is the label
 *  before the first colon; anything after the token is its scopes, joined by "+" (label:token:scope+scope).
 *  Scopes only widen /api/v1/passages (passages:internal = internal documents' text too; without it a caller
 *  gets public passages only). Every other route treats every token alike. Tokens never contain a colon.
 *  Browser callers keep using the session cookie. Either works on every /api/v1 route.
 *  A SAM session JWT sent as a bearer (the SAM Live desktop app) is the cookie in another header. */
export type Caller = { id: string; admin: boolean; via: "token" | "cookie"; scopes: string[] };

function tokens(): Map<string, { id: string; scopes: string[] }> {
  const m = new Map<string, { id: string; scopes: string[] }>();
  for (const entry of (process.env.SAM_API_TOKENS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const [id, token, ...scopes] = entry.split(":");
    if (id && token) m.set(token, { id, scopes: scopes.join(":").split("+").map(s => s.trim()).filter(Boolean) });
  }
  return m;
}

export function callerFromToken(header: string | null): Caller | null {
  const t = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!t) return null;
  const hit = tokens().get(t);
  return hit ? { ...hit, admin: false, via: "token" } : null;
}

export async function resolveCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get("authorization");
  const fromToken = callerFromToken(header);
  if (fromToken) return fromToken;
  // via "cookie" on purpose: a rep's desktop token gets exactly the cookie's rights, so every
  // `via === "cookie" && !admin` gate still holds and it never gains machine-token privileges.
  const jwt = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const fromJwt = jwt ? await verifyToken(jwt) : null;
  if (fromJwt) return { ...fromJwt, via: "cookie", scopes: [] };
  const u: User | null = await currentUser();
  return u ? { id: u.id, admin: u.admin, via: "cookie", scopes: [] } : null;
}

export function unauthorized() {
  return Response.json({ error: "Sign in, or send Authorization: Bearer <token>." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
}
