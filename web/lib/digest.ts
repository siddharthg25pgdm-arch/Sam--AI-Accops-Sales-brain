/** The morning digest: what changed in SAM in the last 24 hours, for the owner of the content-request
 *  queue. GET /api/v1/digest reads the data (app/api/v1/digest/route.ts); this file only assembles
 *  and renders it, so lib/digest.check.mjs can run it on stubbed data.
 *
 *  Order is importance: content requests (the headline), gaps nobody requested, library changes,
 *  usage, and health only when something is wrong. An empty section is left out, not shown as zeros.
 *
 *  The HTML is for email clients, Outlook desktop included: tables, inline styles, no <style>, no
 *  flex/grid, no CSS variables, no images or web fonts. */
import { ratio, type Ratio, type Usage } from "./metrics";
import { STATUS_LABEL, type GapSignal, type RankedRequest } from "./requests";
import type { CardingQueueRow, ChangedFile, SyncRow } from "./sharepoint";

/** Distinct reps at which a request is "worth creating". */
export const WORTH_CREATING = 3;
const FLOW_STALE_H = 48, DELETIONS_STALE_H = 36;

export type DigestInput = {
  now: string;
  /** Origin for links, e.g. https://sam-accops.vercel.app */
  base: string;
  /** Active requests (open, planned, in progress), real traffic only. */
  requests: RankedRequest[] | null;
  /** Automatic gaps from the last 7 days that nobody turned into a request. */
  gaps: GapSignal[] | null;
  changes: ChangedFile[] | null;
  queue: CardingQueueRow[] | null;
  carded: { title: string; filename: string; carded_at: string }[] | null;
  /** Last 24 h, and the 7 x 24 h before it. */
  usage: Usage | null; usagePrev: Usage | null;
  lastFlowWrite: string | null; sync: SyncRow | null; cardCount: number;
  /** Reads that failed. Their sections are missing, not empty, and Health says so. */
  failed: string[];
};

export type DigestRequest = { id: number; title: string; reps: number; new_reps: number; is_new: boolean; worth: boolean;
  first_asked: string; last_asked: string; status: string; owner: string | null; due: string | null; url: string };
export type DigestGap = { title: string; people: number; asks: number; last_asked: string; is_new: boolean; example: string | null };
export type DigestFile = { name: string; folder: string; url: string | null };
export type HealthItem = { title: string; detail: string };
export type Digest = {
  subject: string; lead: string; generated_at: string;
  period: { from: string; to: string; label: string };
  requests: { new_count: number; worth_count: number; open_count: number; items: DigestRequest[]; url: string } | null;
  gaps: { total: number; items: DigestGap[]; url: string } | null;
  library: {
    changed: number; added: DigestFile[]; modified: DigestFile[]; renamed: DigestFile[]; deleted: DigestFile[];
    carded: { title: string }[]; deletion_check: string | null;
    queue: { uncarded: number; changed_since_card: number; renamed: number; uncarded_names: string[]; changed_names: string[]; renamed_names: string[] };
  } | null;
  usage: {
    questions: number; people: number; answered: Ratio; gaps: number; errors: number; fallback: Ratio; p95_ms: number | null;
    week: { questions_per_day: number; answered: Ratio; fallback: Ratio; p95_ms: number | null } | null;
  } | null;
  health: HealthItem[];
  admin_url: string;
};

// ---------------------------------------------------------------- dates (IST)

const IST = "Asia/Kolkata";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function istParts(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: IST, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: p.hour, mm: p.minute, wd: p.weekday };
}
/** "29 Sep" */
export function day(iso: string | null | undefined): string {
  if (!iso) return "";
  // A bare date (due_date) is already a calendar day; do not shift it through a time zone.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${+m[3]} ${MONTHS[+m[2] - 1]}`;
  const p = istParts(iso);
  return `${p.d} ${MONTHS[p.m - 1]}`;
}
const hoursSince = (iso: string | null | undefined, now: string) => iso ? (Date.parse(now) - Date.parse(iso)) / 3_600_000 : null;
const daysText = (h: number) => h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- assembly (checked)

export function buildDigest(i: DigestInput): Digest {
  const since = new Date(Date.parse(i.now) - 86_400_000).toISOString();
  const admin = `${i.base}/admin`;
  const reqUrl = `${admin}?tab=requests`;

  // Content requests. New = created in the window; new_reps = reps who joined an older one.
  let requests: Digest["requests"] = null;
  if (i.requests?.length) {
    const items = i.requests.map<DigestRequest>(r => ({
      id: r.id, title: r.title, reps: r.demand,
      new_reps: new Set(r.votes.filter(v => v.created_at >= since).map(v => v.user_id)).size,
      is_new: r.created_at >= since, worth: r.demand >= WORTH_CREATING,
      first_asked: r.firstAsked, last_asked: r.lastAsked, status: STATUS_LABEL[r.status] ?? r.status,
      owner: r.owner, due: r.due_date, url: `${reqUrl}#r${r.id}`,
    }));
    requests = { new_count: items.filter(r => r.is_new).length, worth_count: items.filter(r => r.worth).length, open_count: items.length, items, url: reqUrl };
  }

  const gaps = i.gaps?.length ? {
    total: i.gaps.length, url: reqUrl,
    items: i.gaps.slice(0, 5).map(g => ({ title: g.title, people: g.users.length, asks: g.asks, last_asked: g.lastSeen, is_new: g.lastSeen >= since,
      example: g.examples.find(x => x.trim().toLowerCase() !== g.title.toLowerCase()) ?? null })),
  } : null;

  // Library. A rename arrives from the flow as a modify with a new filename; the carding queue is
  // what knows the card still carries the old one.
  const renamedIds = new Set((i.queue ?? []).filter(q => q.reason === "renamed").map(q => q.item_id));
  const file = (f: ChangedFile): DigestFile => ({ name: f.filename, folder: f.folder, url: f.deleted ? null : f.web_url || null });
  const ch = i.changes ?? [];
  const deleted = ch.filter(f => f.deleted && (f.deleted_at ?? "") >= since);
  const live = ch.filter(f => !f.deleted && (f.last_synced ?? "") >= since);
  const added = live.filter(f => (f.created_at ?? "") >= since);
  const renamed = live.filter(f => !added.includes(f) && renamedIds.has(f.item_id));
  const modified = live.filter(f => !added.includes(f) && !renamed.includes(f));
  const q = i.queue ?? [];
  const names = (reason: string) => q.filter(x => x.reason === reason).map(x => x.filename);
  const queue = { uncarded: names("uncarded").length, changed_since_card: names("changed_since_card").length, renamed: names("renamed").length,
    uncarded_names: names("uncarded").slice(0, 3), changed_names: names("changed_since_card").slice(0, 3), renamed_names: names("renamed").slice(0, 3) };
  const syncFresh = (i.sync?.last_run ?? "") >= since;
  const changed = added.length + modified.length + renamed.length + deleted.length;
  const library = changed || i.carded?.length || q.length ? {
    changed, added: added.map(file), modified: modified.map(file), renamed: renamed.map(file), deleted: deleted.map(file),
    carded: (i.carded ?? []).map(c => ({ title: c.title || c.filename })),
    deletion_check: syncFresh ? i.sync?.last_result ?? null : null, queue,
  } : null;

  // Usage. The 7-day side is the 7 x 24 h before the window, so a day is compared with a day.
  const u = i.usage, w = i.usagePrev;
  const usage = u && u.questions > 0 ? {
    questions: u.questions, people: u.people, answered: ratio(u.answered, u.questions), gaps: u.gaps, errors: u.errors,
    fallback: ratio(u.fallback, u.model_attempted), p95_ms: u.p95,
    week: w && w.questions > 0 ? { questions_per_day: Math.round((w.questions / 7) * 10) / 10, answered: ratio(w.answered, w.questions), fallback: ratio(w.fallback, w.model_attempted), p95_ms: w.p95 } : null,
  } : null;

  // Health: only what is wrong.
  const health: HealthItem[] = [];
  if (i.failed.length) health.push({ title: `Could not read ${i.failed.join(", ")}`, detail: "Those parts are missing from this email, not empty. The server log has the error." });
  const flowH = hoursSince(i.lastFlowWrite, i.now);
  if (flowH === null || flowH > FLOW_STALE_H) health.push({
    title: flowH === null ? "The SharePoint change flow has never written" : `No SharePoint change has reached SAM for ${daysText(flowH)}`,
    detail: `${i.lastFlowWrite ? `Last write ${day(i.lastFlowWrite)}. ` : ""}If files were added or edited since, the Power Automate change flow is probably off, and SAM cannot link to anything new.`,
  });
  const delH = hoursSince(i.sync?.last_run, i.now);
  if (delH === null || delH > DELETIONS_STALE_H) health.push({
    title: delH === null ? "Deleted files have never been checked" : `Deleted files not checked for ${daysText(delH)}`,
    detail: `${i.sync?.last_run ? `Deletions last applied ${day(i.sync.last_run)}. ` : ""}${i.sync?.last_result ? `Latest snapshot run: ${i.sync.last_result}. ` : ""}Only a write-mode run of "SAM - daily SharePoint snapshot" counts. Until one succeeds, SAM may link to files that are gone.`,
  });
  if (u && u.provider_failures >= 3 && u.provider_failures >= 0.2 * Math.max(u.model_attempted, 1)) health.push({
    title: "The model provider is failing",
    detail: `${u.provider_failures} of ${u.model_attempted || u.questions} questions hit a provider failure in the last 24 hours${w?.model_attempted ? ` (7 days before: ${w.provider_failures} of ${w.model_attempted})` : ""}. Usually Groq's daily token limit; answers fall back to the smaller model or to retrieval.`,
  });
  if (!i.cardCount) health.push({ title: "The card cache is empty", detail: "SAM is answering from file names only. Check sam_asset_cards and the server log." });

  // The subject and the lead say the same thing: the subject for the inbox, the lead in the email.
  const newReq = requests?.new_count ?? 0, worth = requests?.worth_count ?? 0, qs = usage?.questions ?? 0;
  const parts = [
    newReq && plural(newReq, "new request"),
    worth && `${worth} worth creating`,
    !newReq && !worth && requests && plural(requests.open_count, "open request"),
    changed && plural(changed, "file") + " changed",
    qs && plural(qs, "question"),
    health.length && plural(health.length, "thing") + " to check",
  ].filter(Boolean) as string[];
  const subject = `SAM: ${parts.length ? parts.join(", ") : "nothing new"}`;

  const top = requests?.items[0];
  const lead = !parts.length ? "Nothing new in the last 24 hours. No requests, no library changes, no questions, and nothing needs you."
    : top?.worth ? `"${top.title}" is worth creating: ${plural(top.reps, "rep")} asked.`
    : newReq ? `${plural(newReq, "new content request")} since yesterday morning.`
    : requests ? `${plural(requests.open_count, "content request")} open. Nothing new since yesterday.`
    : health.length && !changed && !qs ? "A quiet day. " + (health.length === 1 ? "One thing needs a look." : `${health.length} things need a look.`)
    : "No new content requests.";

  const p = istParts(i.now);
  return {
    subject, lead, generated_at: i.now,
    period: { from: since, to: i.now, label: `Last 24 hours, to ${p.hh}:${p.mm} IST` },
    requests, gaps, library, usage, health, admin_url: admin,
  };
}

// ---------------------------------------------------------------- HTML (email-safe)

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const INK = "#1d1d1f", GREY = "#6e6e73", LINE = "#e5e5ea", LINK = "#0066cc";
const td = (style: string, inner: string, attrs = "") => `<td ${attrs} style="${FONT}${style}">${inner}</td>`;
const row = (inner: string) => `<tr>${inner}</tr>`;
const table = (inner: string, style = "") => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${style}">${inner}</table>`;
const a = (href: string, text: string, style = "") => `<a href="${esc(href)}" style="color:${LINK};text-decoration:none;${style}">${text}</a>`;
const pill = (text: string, bg: string, fg: string) => `<span style="background:${bg};color:${fg};font-size:11px;font-weight:600;padding:2px 7px;border-radius:9px;white-space:nowrap;">${esc(text)}</span>`;
const dot = ` <span style="color:#c7c7cc;">&middot;</span> `;
const meta = (xs: (string | null | false | undefined)[]) => xs.filter(Boolean).join(dot);
const pct = (r: Ratio) => r.den === 0 ? "–" : r.pct == null ? `${r.num} of ${r.den}` : `${Math.round(r.pct)}%`;
const secs = (ms: number | null) => ms == null ? "–" : ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;

function section(title: string, sub: string, body: string, link?: [string, string]) {
  return row(td(`padding:28px 0 0 0;`, table(
    row(td(`border-top:1px solid ${LINE};padding:22px 0 4px 0;font-size:17px;line-height:22px;font-weight:600;color:${INK};`, esc(title) +
      (link ? `<span style="font-size:13px;font-weight:400;">&nbsp;&nbsp;${a(link[1], esc(link[0]) + " &rsaquo;")}</span>` : ""))) +
    (sub ? row(td(`padding:0 0 10px 0;font-size:13px;line-height:18px;color:${GREY};`, sub)) : "") +
    row(td("", body)))));
}

function fileList(label: string, files: DigestFile[], note = "") {
  if (!files.length) return "";
  const shown = files.slice(0, 5).map(f => f.url ? a(f.url, esc(f.name), `color:${INK};`) : `<span style="color:${GREY};text-decoration:line-through;">${esc(f.name)}</span>`);
  const more = files.length > 5 ? `<span style="color:${GREY};"> and ${files.length - 5} more</span>` : "";
  return row(td(`padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;line-height:20px;color:${INK};`,
    `<b style="font-weight:600;">${esc(label)} ${files.length}</b>${note ? `<span style="color:${GREY};"> &nbsp;${note}</span>` : ""}<br>${shown.join(dot)}${more}`));
}

export function renderHtml(d: Digest): string {
  const out: string[] = [];
  const p = istParts(d.generated_at);

  out.push(row(td(`padding:0 0 4px 0;font-size:13px;line-height:18px;color:${GREY};letter-spacing:0.2px;`, `SAM${dot}Morning digest`)));
  out.push(row(td(`padding:0;font-size:24px;line-height:30px;font-weight:700;color:${INK};`, esc(`${p.wd}, ${p.d} ${MONTHS[p.m - 1]}`))));
  out.push(row(td(`padding:4px 0 0 0;font-size:13px;line-height:18px;color:${GREY};`, esc(d.period.label))));
  out.push(row(td(`padding:18px 0 0 0;font-size:16px;line-height:23px;color:${INK};`, esc(d.lead))));

  if (d.requests) {
    const r = d.requests;
    const items = r.items.slice(0, 8).map(x => row(
      td(`width:52px;padding:12px 12px 12px 0;border-bottom:1px solid ${LINE};vertical-align:top;text-align:center;`,
        `<div style="font-size:22px;line-height:24px;font-weight:700;color:${x.worth ? "#b25000" : INK};">${x.reps}</div><div style="font-size:11px;line-height:14px;color:${GREY};">${x.reps === 1 ? "rep" : "reps"}</div>`, `width="52" valign="top"`) +
      td(`padding:12px 0;border-bottom:1px solid ${LINE};vertical-align:top;`,
        `<div style="font-size:15px;line-height:21px;font-weight:600;">${a(x.url, esc(x.title), `color:${INK};`)}</div>` +
        `<div style="padding-top:3px;font-size:13px;line-height:18px;color:${GREY};">${meta([
          x.worth && pill("Worth creating", "#fff1e0", "#9a5b00"), x.is_new && pill("New", "#e8f2ff", "#0058b0"),
          !x.is_new && x.new_reps > 0 && `+${x.new_reps} since yesterday`,
          esc(x.status), `asked ${day(x.first_asked)}${x.last_asked.slice(0, 10) !== x.first_asked.slice(0, 10) ? `&ndash;${day(x.last_asked)}` : ""}`,
          x.owner ? `owner ${esc(x.owner)}` : "no owner", x.due && `due ${day(x.due)}`,
        ])}</div>`, `valign="top"`))).join("");
    const more = r.items.length > 8 ? row(td(`padding:10px 0 0 0;font-size:13px;color:${GREY};`, `${r.items.length - 8} more in the queue.`, `colspan="2"`)) : "";
    out.push(section("Content requests",
      `${plural(r.open_count, "open request")}, most-wanted first. Demand is distinct reps; ${WORTH_CREATING} or more is worth creating.`,
      table(items + more), ["Open the queue", r.url]));
  }

  if (d.gaps) {
    const items = d.gaps.items.map(g => row(td(`padding:10px 0;border-bottom:1px solid ${LINE};`,
      `<div style="font-size:15px;line-height:21px;color:${INK};">${esc(g.title)}</div>` +
      `<div style="padding-top:2px;font-size:13px;line-height:18px;color:${GREY};">${meta([
        g.is_new && pill("New", "#e8f2ff", "#0058b0"), plural(g.people, "person", "people"), plural(g.asks, "ask"), `last ${day(g.last_asked)}`,
        g.example && `&ldquo;${esc(g.example)}&rdquo;`])}</div>`))).join("");
    out.push(section("Asked for, never requested",
      `SAM had nothing for these in the last 7 days and nobody asked marketing.${d.gaps.total > 5 ? ` Top 5 of ${d.gaps.total}.` : ""} Turn one into a request from the queue.`,
      table(items), ["Review", d.gaps.url]));
  }

  if (d.library) {
    const l = d.library, qu = l.queue;
    const rows = [
      fileList("Added", l.added, "SAM can link to these now"),
      fileList("Modified", l.modified),
      fileList("Renamed", l.renamed),
      fileList("Deleted", l.deleted, "SAM no longer links to these"),
      l.carded.length ? row(td(`padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;line-height:20px;color:${INK};`,
        `<b style="font-weight:600;">Carded overnight ${l.carded.length}</b><span style="color:${GREY};"> &nbsp;SAM can describe these now</span><br>${l.carded.slice(0, 5).map(c => esc(c.title)).join(dot)}${l.carded.length > 5 ? `<span style="color:${GREY};"> and ${l.carded.length - 5} more</span>` : ""}`)) : "",
      qu.uncarded || qu.changed_since_card || qu.renamed ? row(td(`padding:8px 0;font-size:14px;line-height:20px;color:${INK};`,
        `<b style="font-weight:600;">Waiting for a card</b><br>` + [
          qu.uncarded && `${qu.uncarded} SAM can find but can&rsquo;t describe yet <span style="color:${GREY};">(${qu.uncarded_names.map(esc).join(", ")}${qu.uncarded > 3 ? ", &hellip;" : ""})</span>`,
          qu.changed_since_card && `${qu.changed_since_card} changed since their card <span style="color:${GREY};">(${qu.changed_names.map(esc).join(", ")}${qu.changed_since_card > 3 ? ", &hellip;" : ""})</span>`,
          qu.renamed && `${qu.renamed} renamed, card still has the old name <span style="color:${GREY};">(${qu.renamed_names.map(esc).join(", ")}${qu.renamed > 3 ? ", &hellip;" : ""})</span>`,
        ].filter(Boolean).join("<br>"))) : "",
      l.deletion_check ? row(td(`padding:8px 0 0 0;font-size:13px;line-height:18px;color:${GREY};`, `Deletion check: ${esc(l.deletion_check)}`)) : "",
    ].join("");
    out.push(section("Library", l.changed ? `${plural(l.changed, "file")} changed in SharePoint Sales Collateral.` : "No SharePoint changes in the last 24 hours.", table(rows)));
  }

  if (d.usage) {
    const u = d.usage, w = u.week;
    const stat = (v: string, label: string) => td(`width:33%;padding:4px 0;vertical-align:top;`,
      `<div style="font-size:26px;line-height:30px;font-weight:700;color:${INK};">${v}</div><div style="font-size:12px;line-height:16px;color:${GREY};">${label}</div>`, `width="33%" valign="top"`);
    const detail = meta([plural(u.gaps, "gap"), plural(u.errors, "error"), `fallback ${pct(u.fallback)}`, `p95 ${secs(u.p95_ms)}`]);
    const week = w ? `7-day average: ${w.questions_per_day} questions a day${dot}${pct(w.answered)} answered${dot}fallback ${pct(w.fallback)}${dot}p95 ${secs(w.p95_ms)}` : "No questions in the 7 days before, so nothing to compare with.";
    out.push(section("Usage", "Real traffic only; test identities and local development are left out.", table(
      row(stat(String(u.questions), u.questions === 1 ? "question" : "questions") + stat(String(u.people), u.people === 1 ? "person" : "people") + stat(pct(u.answered), "answered")) +
      row(td(`padding:10px 0 0 0;font-size:13px;line-height:19px;color:${INK};`, detail, `colspan="3"`)) +
      row(td(`padding:2px 0 0 0;font-size:13px;line-height:19px;color:${GREY};`, week, `colspan="3"`)))));
  }

  if (d.health.length) {
    const items = d.health.map(h => row(td(`padding:10px 0 10px 12px;border-left:3px solid #ff9f0a;`,
      `<div style="font-size:15px;line-height:21px;font-weight:600;color:${INK};">${esc(h.title)}</div><div style="padding-top:2px;font-size:13px;line-height:18px;color:${GREY};">${esc(h.detail)}</div>`)) +
      row(td("height:8px;font-size:0;line-height:0;", "&nbsp;"))).join("");
    out.push(section("Needs a look", "", table(items), ["System", `${d.admin_url}?tab=system`]));
  }

  out.push(row(td(`padding:32px 0 0 0;font-size:12px;line-height:18px;color:${GREY};`,
    `<div style="border-top:1px solid ${LINE};padding-top:16px;">${a(d.admin_url, "Open the SAM dashboard")}</div>` +
    `<div style="padding-top:4px;">You get this because you own marketing&rsquo;s content-request queue. Sent at 08:30 IST by your Power Automate flow.</div>`)));

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(d.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f5f5f7;">` +
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(d.lead)}</div>` +
    table(row(td("padding:24px 12px;", `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->` +
      table(row(td("padding:28px 24px 28px 24px;", table(out.join("")))), "max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;") +
      `<!--[if mso]></td></tr></table><![endif]-->`, `align="center"`)), "background:#f5f5f7;") +
    `</body></html>`;
}
