"use server";
/** Marketing's controls on the Requests tab. Server actions, so the dashboard stays server-rendered
 *  with no client JS; each one re-checks that the caller is an admin, then redirects back to the tab
 *  with a one-line result (?ok= / ?err=) and the request's anchor. */
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { updateRequest, mergeRequests, promoteGap, type Status } from "@/lib/requests";

async function admin() {
  const u = await currentUser();
  if (!u?.admin) redirect("/");
  return u;
}
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v : undefined; };

function back(fd: FormData, msg: { ok?: string; err?: string }, anchor = ""): never {
  const q = new URLSearchParams(str(fd, "back") ?? "tab=requests");
  q.delete("ok"); q.delete("err");
  if (msg.ok) q.set("ok", msg.ok);
  if (msg.err) q.set("err", msg.err);
  redirect(`/admin?${q}${anchor ? `#${anchor}` : ""}`);
}

export async function saveRequest(fd: FormData) {
  const u = await admin();
  const id = Number(str(fd, "id"));
  const r = await updateRequest(id, {
    status: (str(fd, "status") ?? "open") as Status, owner: str(fd, "owner"), due_date: str(fd, "due_date"),
    delivered_title: str(fd, "delivered_title"), delivered_url: str(fd, "delivered_url"), decline_reason: str(fd, "decline_reason"), notes: str(fd, "notes"),
  }, u.id);
  if (!r.ok) back(fd, { err: r.error }, `r${id}`);
  const status = str(fd, "status");
  back(fd, { ok: status === "done" ? `Delivered. Everyone who asked will see it${r.notified ? `; ${r.notified} told on WhatsApp` : ""}.` : "Saved." }, `r${id}`);
}

export async function mergeRequest(fd: FormData) {
  const u = await admin();
  const from = Number(str(fd, "id")), into = Number(str(fd, "into"));
  const r = await mergeRequests(from, into, u.id);
  back(fd, r.ok ? { ok: "Merged. Its askers now count on the other request." } : { err: r.error }, r.ok ? `r${into}` : `r${from}`);
}

export async function promote(fd: FormData) {
  await admin();
  let users: string[] = [];
  try { users = JSON.parse(str(fd, "users") ?? "[]"); } catch { /* empty */ }
  const r = await promoteGap({ key: str(fd, "key") ?? "", title: str(fd, "title") ?? "", users, example: str(fd, "example") });
  back(fd, r.ok ? { ok: `Now a request: ${r.title}. The ${users.length === 1 ? "person" : `${users.length} people`} who asked will hear when it is delivered.` } : { err: r.error }, r.ok ? `r${r.id}` : "");
}
