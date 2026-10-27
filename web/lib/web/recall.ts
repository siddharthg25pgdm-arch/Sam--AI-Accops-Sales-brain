/** Welcome-back memory (Siddharth, 27 Oct 2026; Qualified's "Welcome back! Since you were exploring ZTNA before…").
 *  Per DEVICE, never per IP (a shared office or mobile IP would show one person's topics to a colleague): the loader
 *  keeps a random UUID in the host page's own storage for 90 days (this visit only for EU/EEA/UK/CH: `persist`) and
 *  passes it to /embed and the config call. The 07 SQL's sam_web_recall returns the device's last approved pairs and
 *  last public page. Only APPROVED question labels (re-checked here against the live sam_web_qa_public list) and
 *  public page-card titles are ever echoed: never the visitor's typed text, never a model answer. */
import type { Chip } from "@/lib/blocks";
import { emClean } from "@/lib/emphasis";
import * as db from "./db";
import { chips, cut } from "./fill";
import { related } from "./intent";
import { suggest } from "./suggest";

/** crypto.randomUUID()'s shape: the loader's ids, and the 07 SQL's own check. Anything else is never recalled. */
export const VID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// EU 27 + EEA (IS, LI, NO) + UK + CH: no consent banner on the LP, so the id lasts this visit only (sessionStorage).
const SESSION_ONLY = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split(" "));
/** Keep the id on the device for 90 days? Decided from Vercel's x-vercel-ip-country only, never the client; unknown = no. */
export const persist = (country: string | null) => !!country && /^[A-Z]{2}$/.test(country) && !SESSION_ONLY.has(country);

/** line: the greeting (**emphasis** within the contract's limits); qa_id: what the teaser asks when clicked;
 *  chips: what the chat offers under the greeting (the page's own suggestions follow, see `offers`). */
export type Welcome = { line: string; qa_id: string; chips: Chip[] };

/** A page card's title as a topic: the part before " | " (site suffixes), without an "Accops - " prefix. */
const topic = (t: string) => cut(t.split(" | ")[0].replace(/^Accops\s+[-–]\s+/, "").trim(), 60);

async function build(vid: string, page: string): Promise<Welcome | null> {
  const r = await db.recall(vid, page);
  if (!r) return null;
  const live = new Map((await db.pairs()).map(q => [q.id, q])); // approved right now (the SQL joined the same view)
  const asked = (r.last_qa ?? []).map(x => live.get(String(x?.id))).filter((q): q is db.QaLite => !!q);
  if (asked.length) {
    const [top, ...earlier] = asked, label = chips([top])[0].label;
    const kids = await db.children(top.id).catch(() => []);
    const rel = related(top.question, top.pages?.find(p => !p.includes(":")) ?? "general").flatMap(id => live.get(id) ?? []);
    return { line: emClean(`Welcome back! Last time you looked at **${label}**${/[.?!…]$/.test(label) ? "" : "."} Want to pick up there?`),
      qa_id: top.id, chips: chips([...kids, ...earlier, ...rel], [top.id], 3) };
  }
  const url = r.last_page?.url && URL.canParse(r.last_page.url) ? new URL(r.last_page.url).href : null; // no raw quotes reach PostgREST
  const card = url ? (await db.pageCards([url]))[0] : null; // its public card, re-read: the title is the only page text echoed
  const next = card?.title ? await suggest(card.url, "") : [];
  return next.length ? { line: emClean(`Welcome back! Since you were reading about **${topic(card!.title)}**, want to pick up there?`),
    qa_id: next[0].id, chips: next.slice(0, 3) } : null;
}

// ponytail: per-instance memo, 60 s per (device, page), cleared past 500 keys (as suggest's).
const TTL = 60_000, memo = new Map<string, { at: number; v: Welcome | null }>();

/** The greeting for a returning device on `page`, or null: a malformed or unknown id, nothing recallable, nothing
 *  approved to offer. The caller decides whether the request is human (bot.ts pageHuman) before asking. */
export async function welcome(vid: string, page: string): Promise<Welcome | null> {
  if (!VID.test(vid)) return null;
  const key = `${vid} ${page}`, hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const v = await build(vid, page);
  if (memo.size > 500) memo.clear();
  memo.set(key, { at: Date.now(), v });
  return v;
}

/** The welcome's offers first, then the page's suggestions: no repeats, never `skip`, at most n. */
export const offers = (w: Welcome | null, rows: Chip[], n: number, skip: string[] = []) =>
  [...(w?.chips ?? []), ...rows].filter((c, i, a) => !skip.includes(c.id) && a.findIndex(x => x.id === c.id) === i).slice(0, n);
