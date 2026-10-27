/** Filling (plan 3.5, text-first since 27 Oct 2026): every visitor-visible field is an approved record, a fixed string
 *  here, or the model's answer AFTER the fact check (facts.ts) and the emphasis limits (emphasis.ts). */
import { SUPPORT_URL } from "@/app/embed/bridge";
import type { Block, Chip } from "@/lib/blocks";
import { emClean } from "@/lib/emphasis";
import type { Candidate, Written } from "./contracts";
import * as db from "./db";
import type { Qa, QaRef, Settings } from "./db";
import { factCheck } from "./facts";
import { analyse, groupNames, weight } from "./intent";

/** The only prose not taken from a record (plan 3.4). Siddharth may edit these strings. */
export const LEAD = {
  partial: "Not exactly that, but this is the closest we've published:",
  none: "I don't have that on our public pages yet. The team can answer it directly.",
  limited: "You've asked a lot in a short time. Pick a question below or talk to the team.",
  repeat: "Looks like this one needs a person. The team can answer it directly.",
  facts: "Here's what we've published on that:", // verified facts: the model's answer failed the fact check, or no model answer
  triage: "Happy to help. Which of these is closest to what you need?", // a vague problem (intent.ts vague)
} as const;

/** The triage chips for a vague problem (benchmark, 27 Oct: Scout's sales / support split). Each maps to an approved
 *  pair (answer.ts keeps only the live ones), then the support route for existing customers: the ticket portal that
 *  accops.com/contact-us publishes ("Technical support: support@accops.com and the ticket portal support.accops.com"). */
export const TRIAGE: Chip[] = [
  { id: "lp-05", label: "Moving off Citrix" },
  { id: "lp-40", label: "Remote access / VPN replacement" },
  { id: "lp-36", label: "Securing logins (MFA/SSO)" },
];
export const SUPPORT: Chip = { id: "support", label: "I'm an existing Accops customer (support)", url: SUPPORT_URL };

export const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

// A page with no public card, named for a visitor (benchmark, 27 Oct: "From accops-citrix-lp.vercel.app" read as a test site).
const FRIENDLY: Record<string, string> = { "accops-citrix-lp.vercel.app": "Citrix comparison page" };

/** The pill for a URL: { label, url }, or nothing for a value that is not an http(s) URL. The label here is the page's
 *  friendly name or "accops.com/hysecure"; `titled` swaps in the public card's title before the answer leaves. */
export function source(url: string | null | undefined) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) return undefined;
    const host = u.host.replace(/^www\./, "");
    return { label: cut(FRIENDLY[host] ?? `${host}${u.pathname.replace(/\/$/, "")}`, 60), url: u.href };
  } catch { return undefined; }
}

/** A page card's title as a topic: the part before " | " (site suffixes), without an "Accops - " prefix. */
export const topic = (t: string) => cut(t.split(" | ")[0].replace(/^Accops\s+[-–]\s+/, "").trim(), 60);

/** The pill's words for a source URL: its public card's title (the exact URL, else the page without its #anchor), else
 *  source()'s friendly name. A generated "#section-N" anchor (an LP section with no id) never uses its own card: those
 *  titles are the carder's descriptions ("Hero: …", "… (pending sign-off)"), not headings a visitor sees. */
export function pill(url: string, cards: { url: string; title: string }[]) {
  const u = new URL(url), page = u.origin + u.pathname.replace(/\/+$/, "");
  const ok = (c: { url: string; title: string }, ...want: string[]) => !!c.title && want.includes(c.url);
  const card = (/^#section-\d+$/.test(u.hash) ? undefined : cards.find(c => ok(c, u.href))) ?? cards.find(c => ok(c, page, `${page}/`));
  return card ? topic(card.title) : source(url)!.label;
}

// ponytail: per-instance memo, 10 min per URL (titles change with a recard), cleared past 500 keys.
const PILL_TTL = 600_000, pills = new Map<string, { at: number; label: string }>();
const srcOf = (b: Block) => ("source" in b ? b.source : undefined);

/** Every pill in an answer names its page (answer.ts runs this on every answer, cached ones included). One read of
 *  sam_web_pages_public for URLs not seen in 10 minutes; if that read fails, the friendly names stay. */
export async function titled(blocks: Block[]): Promise<Block[]> {
  const now = Date.now(), urls = [...new Set(blocks.flatMap(b => srcOf(b)?.url ?? []))];
  const miss = urls.filter(u => !(now - (pills.get(u)?.at ?? 0) < PILL_TTL));
  if (miss.length) {
    const ask = [...new Set(miss.flatMap(x => { const u = new URL(x), p = u.origin + u.pathname.replace(/\/+$/, ""); return [u.href, p, `${p}/`]; }))];
    const cards = await db.pageCards(ask).catch(() => null);
    if (cards) { if (pills.size > 500) pills.clear(); for (const u of miss) pills.set(u, { at: now, label: pill(u, cards) }); }
  }
  return blocks.map(b => { const s = srcOf(b), l = s && pills.get(s.url)?.label; return s && l ? ({ ...b, source: { ...s, label: l } } as Block) : b; });
}

/** Only an http(s) URL is kept; anything else (javascript:, junk) becomes "" and falls to group `general`, never reflected. */
export const cleanPage = (p: unknown) => {
  const s = String(p ?? "").slice(0, 500);
  return /^https?:\/\//i.test(s) && URL.canParse(s) && !/\s/.test(s) ? s : "";
};

/** A candidate's qa ref -> the pair id (refs may be namespaced "qa:<id>"). */
export const qaId = (ref: string) => ref.replace(/^qa:/, "");

/** A pair's blocks: its verbatim answer as Text, and/or its approved visual. `only` limits to one block type. */
export function qaBlocks(qa: Qa, only?: string): Block[] {
  const src = source(qa.sources?.[0]), out: Block[] = [];
  if (!only || only === "text") out.push({ type: "text", body: qa.answer, ...(src ? { source: src } : {}) });
  const v = qa.visual, d = qa.visual_data;
  // ponytail: the calculator stays off until Siddharth approves public, sourced figures (plan 7.5)
  if (v && v !== "text" && d && (!only || only === v) && (v !== "calculator" || d.figures_approved === true)) {
    const { figures_approved: _f, ...props } = d;
    out.push({ ...props, type: v, ...(src && v !== "picker" && v !== "cta" ? { source: src } : {}) } as Block);
  }
  return out;
}

export const cta = (s: Settings, qa?: Qa | null): Block => ({ type: "cta", label: cut(qa?.cta || s.cta_label || "Talk to an expert", 28),
  action: "talk_to_sales", url: (qa?.cta_url || s.cta_url || "https://www.accops.com/schedule-a-free-demo").slice(0, 300) });

export const chips = (rows: QaRef[], skip: string[] = [], n = 3): Chip[] =>
  rows.filter((r, i) => r.id && r.id.length <= 80 && !skip.includes(r.id) && rows.findIndex(x => x.id === r.id) === i)
    .slice(0, n).map(r => ({ id: r.id, label: cut(r.question, 60) }));

/** A public asset (PDF or document) as a card: only when the visitor asked for a document (Siddharth, 27 Oct). */
const docCard = (c: Candidate): Block | null => {
  const src = source(c.url);
  return src && c.kind === "asset" ? { type: "doc_card", title: cut(c.title, 120), kind: "Document", summary: cut(c.text, 220), url: src.url,
    action: /\.pdf($|\?)/i.test(src.url) ? "download" : "read" } : null;
};

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

// Highlights go on Accops (Siddharth, 27 Oct 2026): a clause about a competitor that doesn't name Accops keeps its words but
// loses its ** (the first live answer bolded a Citrix strength). ponytail: static rival list; read core.terms if it grows.
const RIVAL = /\b(citrix|netscaler|vmware|horizon|omnissa|broadcom|azure virtual desktop|avd|windows 365|zscaler|okta)\b/i;
export const accopsFirst = (s: string) =>
  s.split(/(?<=[.!?;])\s+/).map(c => RIVAL.test(c) && !/accops/i.test(c) ? c.replace(/\*\*/g, "") : c).join(" ");
const words = (s: string) => s.replace(/\*/g, "").split(/\s+/).filter(Boolean).length;

/** The model's written answer -> blocks, or `problems` when it may not be shown (the caller then shows verified facts).
 *  Text: whitespace collapsed, whole sentences up to 70 words, emphasis within the limits (emphasis.ts), fact-checked
 *  against the title + text of the candidates it cites (facts.ts), with ONE "Based on" pill from the first cite.
 *  Then a qa candidate's own approved visual if the model chose one (a doc card only on a document ask), then a
 *  document card for a document ask. Never a page card: pages feed facts only. */
export function compose(w: Written, cands: Candidate[], pairs: Map<string, Qa>, askedForDoc: boolean): { blocks: Block[]; problems: string[] } {
  const byRef = new Map(cands.map(c => [c.ref, c]));
  const cited = [...new Set(w.cites)].map(r => byRef.get(r)).filter((c): c is Candidate => !!c);
  let kept = "", n = 0;
  for (const s of sentences(w.answer.replace(/\s+/g, " ").trim())) { if (n + words(s) > 70) break; kept += `${kept ? " " : ""}${s}`; n += words(s); }
  const body = emClean(accopsFirst(kept)).replace(/ {2,}/g, " ").trim();
  const src = cited.map(c => source(c.kind === "qa" ? pairs.get(qaId(c.ref))?.sources?.[0] ?? c.url : c.url)).find(Boolean);
  const problems = [
    ...(!cited.length ? ["no cites"] : []), ...(!body ? ["empty or over 70 words"] : []), ...(body.length > 600 ? ["over 600 chars"] : []),
    ...(!src ? ["no source"] : []), ...factCheck(body, cited.map(c => `${c.title}. ${c.text}`)),
  ];
  if (problems.length) return { blocks: [], problems };
  const blocks: Block[] = [{ type: "text", body, source: src, ai: true }];
  const v = byRef.get(w.visual.ref), qa = v?.kind === "qa" ? pairs.get(qaId(v.ref)) : undefined;
  if (qa && w.visual.type !== "text" && v!.types.includes(w.visual.type) && (w.visual.type !== "doc_card" || askedForDoc)) blocks.push(...qaBlocks(qa, w.visual.type));
  if (askedForDoc && !blocks.some(b => b.type === "doc_card")) {
    const d = [...cited, ...cands].map(docCard).find(Boolean);
    if (d) blocks.push(d);
  }
  return { blocks, problems: [] };
}

/** A text's words and core.terms names, as the intent matcher sees them ("@" marks a name: Entra ID meets Azure AD). */
const keys = (text: string, fuzzy = false) => { const a = analyse(text, fuzzy); return [...a.terms, ...a.entities.map(e => `@${e}`)]; };
// Relevance (benchmark, 27 Oct: "Does Accops support SAML SSO with Microsoft Entra ID?" got the SSO answer plus the
// OEM-support and CEO/Pune quotes as filler). A record must share a TOPIC word or name with the question: the stems
// below say nothing about a topic (there "support" is the verb; SAML, SSO, Microsoft, Entra and Azure AD are the topic).
// The page group's own subject is context there, not a topic (the index's group_entities: Citrix on the Citrix LP, where
// nearly every quote names it and "compared with" is the page's whole frame). Shared words weigh as the intent matcher
// weighs them (an unknown word counts as rare), a shared core.terms name NAME_W (so an alias links: Entra ID meets Azure
// AD). A kept record scores at least NEAR_BEST of the best one. A question with no topic word gets no quotes.
// ponytail: bag of words; a paraphrase the index can't link is a miss, and a miss is the honest fallback, never filler.
// Tune here if good quotes start dropping (the eval's verified-facts cases show it).
const GENERIC = new Set(("use suppor work run offer give provid make help includ allow enabl handl availa compan produc soluti featur " +
  "option custom user team busine enterp organi manag system servic platfo access secur compar").split(" "));
const NAME_W = 2, NEAR_BEST = 0.6;
const topicWeight = (k: string) => (k.startsWith("@") ? NAME_W : weight(k));

/** Verified facts (the fallback for a failed fact check or a failed model): 1-3 verbatim records that answer `q` (asked
 *  on a page of `group`), `first` (the cites) then search rank. An approved answer with its own source, or a page quote
 *  with its page (a quote carries no emphasis). A record counts only if it shares a topic word or name with the question
 *  and scores NEAR_BEST of the best such record (see GENERIC): never filler, and none at all means the honest fallback.
 *  Never a page summary and never a list of links. A document card follows only on a document ask. */
export function facts(q: string, group: string, first: string[], cands: Candidate[], pairs: Map<string, Qa>, askedForDoc: boolean): Block[] {
  const byRef = new Map(cands.map(c => [c.ref, c])), seen = new Set<string>(), rows: { b: Block; rel: number }[] = [];
  const context = new Set(groupNames(group).flatMap(e => [`@${e}`, ...analyse(e, false).terms]));
  const want = keys(q, true).filter(k => !GENERIC.has(k) && !context.has(k));
  for (const r of [...new Set([...first, ...cands.map(c => c.ref)])]) {
    const c = byRef.get(r);
    if (!c) continue;
    const qa = c.kind === "qa" ? pairs.get(qaId(c.ref)) : undefined;
    const body = qa ? qa.answer : c.kind === "fact" ? c.text.replace(/\*/g, "").slice(0, 600) : "";
    const src = source(qa ? qa.sources?.[0] : c.url);
    if (!body || !src || seen.has(body)) continue;
    seen.add(body);
    const have = new Set(keys(`${qa?.question ?? c.title}. ${body}`)), rel = want.filter(k => have.has(k)).reduce((s, k) => s + topicWeight(k), 0);
    if (rel > 0) rows.push({ b: { type: "text", body, source: src }, rel });
  }
  const best = Math.max(0, ...rows.map(x => x.rel));
  const out = rows.filter(x => x.rel >= NEAR_BEST * best).slice(0, 3).map(x => x.b);
  const d = askedForDoc ? [...first.map(r => byRef.get(r)).filter((c): c is Candidate => !!c), ...cands].map(docCard).find(Boolean) : null;
  return d ? [...out, d] : out;
}
