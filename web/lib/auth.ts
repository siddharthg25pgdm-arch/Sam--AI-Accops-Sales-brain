import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/** SAM_USERS="siddharth:secret,rahul:otherpass[,name:pass:admin]" — third field "admin" grants /admin. */
export type User = { id: string; admin: boolean };
const COOKIE = "sam_session";

function users(): Map<string, { password: string; admin: boolean }> {
  const m = new Map<string, { password: string; admin: boolean }>();
  for (const entry of (process.env.SAM_USERS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const [id, password, role] = entry.split(":");
    if (id && password) m.set(id.toLowerCase(), { password, admin: role === "admin" });
  }
  return m;
}
function secret() {
  const s = process.env.SAM_SESSION_SECRET ?? "dev-only-secret-change-me-please-0123456789";
  return new TextEncoder().encode(s);
}
export function usersConfigured() { return users().size > 0; }

export async function login(id: string, password: string): Promise<User | null> {
  const u = users().get(id.trim().toLowerCase());
  if (!u || u.password !== password) return null;
  const user: User = { id: id.trim().toLowerCase(), admin: u.admin };
  const token = await new SignJWT(user).setProtectedHeader({ alg: "HS256" }).setExpirationTime("30d").sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return user;
}
export async function logout() { (await cookies()).delete(COOKIE); }

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: String(payload.id), admin: Boolean(payload.admin) };
  } catch { return null; }
}
