/** Page-aware suggestions (Siddharth, 27 Oct 2026: "the bot should be able to detect which page the user is on and suggest
 *  questions basis that"): the teaser, the teaser card's chips and the widget's starter questions for a page URL and the
 *  section the visitor is reading (the loader's IntersectionObserver; SEC-allowlisted). APPROVED pairs of the page's
 *  group (sam_web_qa_public), best first:
 *    0. a source IS page#section              2. names one of the page card's products / industries
 *    1. a source is on the page (any anchor)  3. the group's roots (filler, sam_web_roots order)
 *  Inside a tier: the order of the card's own questions_answered (each mapped to a pair: a confident intent match, else
 *  the best-ranked pair citing the section), then pairs whose sources[0] matched, then nudge_weight, then id. Tier 2
 *  first orders by the card label matched: an industry page's industries come before its products, any other page's
 *  products first. Card labels and pairs meet as core.terms entities (the intent index's), so "Pharma / Healthcare"
 *  meets a pair asking about hospitals or tagged industry:healthcare. [0] is the teaser. Up to 8 come back, so the
 *  browser, which holds the conversation, can drop what was already asked and still show 4. */
import type { Chip } from "@/lib/blocks";
import * as db from "./db";
import { chips } from "./fill";
import { analyse, intentMatch, related } from "./intent";

type At = { p: string; h: string } | null;
/** host without www + path without a trailing slash, and the #anchor. */
const at = (u: string): At => {
  try { const x = new URL(u); return { p: x.host.replace(/^www\./, "") + x.pathname.replace(/\/+$/, ""), h: x.hash.slice(1) }; }
  catch { return null; }
};
const topics = (s: string) => analyse(s, false).entities;
const tagWords = (pages: string[] | null) => (pages ?? []).filter(p => p.includes(":")).map(p => p.split(":")[1].replace(/-/g, " ")).join(" ");

// ponytail: per-instance memo, 60 s (config is also CDN-cached 300 s per full URL, section included). Any page URL can be
// asked for, so the map is cleared past 500 keys; an LRU if that ever churns.
const TTL = 60_000, memo = new Map<string, { at: number; v: Chip[] }>();

export async function suggest(page: string, section: string): Promise<Chip[]> {
  const key = `${page} ${section}`, hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const here = at(page), u = here ? new URL(page) : null, b = u ? u.origin + u.pathname.replace(/\/+$/, "") : "";
  // the section's card first (the LP's are "<page>/#<id>"), then the page's own; with and without the trailing slash
  const urls = b ? [...(section ? [`${b}/#${section}`, `${b}#${section}`] : []), `${b}/`, b] : [];
  const [group, rows, cards, roots] = await Promise.all([
    page ? db.pageGroup(page).catch(() => "general") : "general",
    db.pairs().catch(() => [] as db.QaLite[]),
    urls.length ? db.pageCards(urls).catch(() => [] as db.PageCard[]) : [],
    db.roots(page), // fails the call, as before: the config route answers 503
  ]);
  const inGroup = (g: string) => rows.filter(r => r.pages?.includes(g));
  const g = inGroup(group).length ? group : "general", pool = inGroup(g);
  const card = urls.map(x => cards.find(c => c.url === x)).find(Boolean);
  const labels = card ? (card.page_type === "industry" ? [...card.industries ?? [], ...card.products ?? []] : [...card.products ?? [], ...card.industries ?? []]) : [];
  const want = [...new Set(labels.flatMap(topics))];

  const exact = (x: At) => !!x && x.p === here?.p && x.h === section, same = (x: At) => !!x && x.p === here?.p;
  const src = new Map(pool.map(r => [r.id, (r.sources ?? []).map(at)]));
  const live = new Set(pool.map(r => r.id)), t0 = new Set(pool.filter(r => src.get(r.id)!.some(exact)).map(r => r.id));
  const qpos = new Map<string, number>();
  (card?.questions_answered ?? []).forEach((q, i) => {
    const m = intentMatch(q, g)?.qa_id, id = m && live.has(m) ? m : related(q, g, 20).find(x => t0.has(x));
    if (id && !qpos.has(id)) qpos.set(id, i);
  });

  const ranked = pool.flatMap(r => {
    const s = src.get(r.id)!, q = qpos.get(r.id) ?? 99;
    if (s.some(exact)) return [{ r, k: [0, 0, q, exact(s[0]) ? 0 : 1] }];
    if (s.some(same)) return [{ r, k: [1, 0, q, same(s[0]) ? 0 : 1] }];
    const i = Math.min(...[...topics(r.question), ...topics(tagWords(r.pages))].map(t => want.indexOf(t)).filter(n => n >= 0));
    return Number.isFinite(i) ? [{ r, k: [2, i, q, 0] }] : [];
  }).sort((a, b) => a.k.reduce((d, v, j) => d || v - b.k[j], 0) || (b.r.nudge_weight ?? 0) - (a.r.nudge_weight ?? 0) || (a.r.id < b.r.id ? -1 : 1));

  const v = chips([...ranked.map(x => x.r), ...roots], [], 8);
  if (memo.size > 500) memo.clear();
  memo.set(key, { at: Date.now(), v });
  return v;
}
