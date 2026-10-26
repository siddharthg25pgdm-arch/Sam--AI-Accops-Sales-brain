"use server";
/** The Website tab's controls: approve / edit / retire a Q&A pair, draft a pair from a missed question, add a missed
 *  question as an alias, and the chatbot's settings. Same pattern as actions.ts: each re-checks the admin, writes with
 *  the service key (lib/web-dashboard.ts), then redirects back with a one-line result (?ok= / ?err=) and an anchor. */
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { addAlias, draftRow, insertDraft, loadSettings, settingsPatch, writeDecision, writeSettings, type Decision } from "@/lib/web-dashboard";

async function admin() {
  const u = await currentUser();
  if (!u?.admin) redirect("/");
  return u;
}
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v : undefined; };

function back(fd: FormData, msg: { ok?: string; err?: string }, anchor = ""): never {
  const q = new URLSearchParams(str(fd, "back") ?? "tab=website");
  q.delete("ok"); q.delete("err");
  if (msg.ok) q.set("ok", msg.ok);
  if (msg.err) q.set("err", msg.err);
  redirect(`/admin?${q}${anchor ? `#${anchor}` : ""}`);
}
const fail = (e: unknown) => `Could not save: ${e instanceof Error ? e.message : "unknown error"}`;

const DONE: Record<Decision, string> = {
  approve: "Approved. Clicks and chips can show it within 5 minutes; typed questions find it after the next intent-index build.",
  edit: "Answer saved and approved. Clicks and chips can show it within 5 minutes; typed questions find it after the next intent-index build.",
  retire: "Retired. It leaves the website within 5 minutes and stops answering at once.",
};

/** Approve, Edit (replace the answer, then approve) or Retire one pair. */
export async function decidePair(fd: FormData) {
  const u = await admin();
  const id = str(fd, "id") ?? "", d = str(fd, "decision") as Decision;
  if (!["approve", "edit", "retire"].includes(d)) back(fd, { err: "Unknown decision." }, `qa-${id}`);
  let r: Awaited<ReturnType<typeof writeDecision>>;
  try { r = await writeDecision(id, d, u.id, d === "edit" ? str(fd, "answer") : undefined); }
  catch (e) { back(fd, { err: fail(e) }, `qa-${id}`); }
  back(fd, r.ok ? { ok: `${id}: ${DONE[d]}` } : { err: `${id}: ${r.error}` }, `qa-${id}`);
}

/** A missed question becomes a new draft pair, waiting in the approval queue like the rest. */
export async function draftPair(fd: FormData) {
  await admin();
  const r = draftRow({ question: str(fd, "question") ?? "", answer: str(fd, "answer") ?? "", source: str(fd, "source") ?? "",
    page_group: str(fd, "page_group") ?? "general", parent_id: str(fd, "parent_id") || null }, randomBytes(4).toString("hex"));
  if ("error" in r) back(fd, { err: r.error }, "missed");
  try { await insertDraft(r.row); } catch (e) { back(fd, { err: fail(e) }, "missed"); }
  back(fd, { ok: `Drafted ${r.row.id}. Approve it in Approve Q&A when it reads right.` }, "missed");
}

/** A missed question as another way of asking an existing pair. */
export async function aliasPair(fd: FormData) {
  await admin();
  const id = str(fd, "id") ?? "";
  let r: Awaited<ReturnType<typeof addAlias>>;
  try { r = await addAlias(id, str(fd, "question") ?? ""); } catch (e) { back(fd, { err: fail(e) }, "missed"); }
  back(fd, !r.ok ? { err: r.error ?? "Could not add it." } : r.added
    ? { ok: `Added as an alias of ${id}. The intent matcher learns it at the next build: python prototype/build_intent_index.py.` }
    : { ok: `${id} already has that wording.` }, "missed");
}

export async function saveWebSettings(fd: FormData) {
  await admin();
  const form = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  let p: ReturnType<typeof settingsPatch>;
  try { p = settingsPatch(form, await loadSettings()); } catch (e) { back(fd, { err: fail(e) }, "settings"); }
  if ("error" in p) back(fd, { err: p.error }, "settings");
  if (!p.changes.length) back(fd, { ok: "Nothing changed." }, "settings");
  try { await writeSettings(p.changes); } catch (e) { back(fd, { err: fail(e) }, "settings"); }
  back(fd, { ok: `Saved: ${p.changes.map(c => c.key.replace(/_/g, " ")).join(", ")}. Questions use it at once; the launcher's on/off within 5 minutes.` }, "settings");
}
