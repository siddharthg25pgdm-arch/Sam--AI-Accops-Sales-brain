/** Filling (plan 3.5, text-first since 27 Oct 2026): every visitor-visible field is an approved record, a fixed string
 *  here, or the model's answer AFTER the fact check (facts.ts) and the emphasis limits (emphasis.ts). */
import type { Block, Chip } from "@/lib/blocks";
import { emClean } from "@/lib/emphasis";
import type { Candidate, Written } from "./contracts";
import type { Qa, QaRef, Settings } from "./db";
import { factCheck } from "./facts";

/** The only prose not taken from a record (plan 3.4). Siddharth may edit these strings. */
export const LEAD = {
  partial: "Not exactly that, but this is the closest we've published:",
  none: "I don't have that on our public pages yet. The team can answer it directly.",
  limited: "You've asked a lot in a short time. Pick a question below or talk to the team.",
  repeat: "Looks like this one needs a person. The team can answer it directly.",
  facts: "Here's what we've published on that:", // verified facts: the model's answer failed the fact check, or no model answer
} as const;

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** "accops.com/hysecure" + the URL, or nothing for a value that is not an http(s) URL. */
export function source(url: string | null | undefined) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) return undefined;
    return { label: cut(`${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`, 60), url: u.href };
  } catch { return undefined; }
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

export const chips = (rows: QaRef[], skip: string[] = []): Chip[] =>
  rows.filter((r, i) => r.id && r.id.length <= 80 && !skip.includes(r.id) && rows.findIndex(x => x.id === r.id) === i)
    .slice(0, 3).map(r => ({ id: r.id, label: cut(r.question, 60) }));

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

/** Verified facts (the fallback for a failed fact check or a failed model): up to 3 verbatim records, `first` (the cites)
 *  then search rank. An approved answer with its own source, or a page quote with its page (a quote carries no emphasis).
 *  Never a page summary and never a list of links. A document card follows only on a document ask. */
export function facts(first: string[], cands: Candidate[], pairs: Map<string, Qa>, askedForDoc: boolean): Block[] {
  const byRef = new Map(cands.map(c => [c.ref, c])), out: Block[] = [], seen = new Set<string>();
  for (const r of [...new Set([...first, ...cands.map(c => c.ref)])]) {
    const c = byRef.get(r);
    if (!c || out.length >= 3) continue;
    const qa = c.kind === "qa" ? pairs.get(qaId(c.ref)) : undefined;
    const body = qa ? qa.answer : c.kind === "fact" ? c.text.replace(/\*/g, "").slice(0, 600) : "";
    const src = source(qa ? qa.sources?.[0] : c.url);
    if (!body || !src || seen.has(body)) continue;
    seen.add(body);
    out.push({ type: "text", body, source: src });
  }
  const d = askedForDoc ? [...first.map(r => byRef.get(r)).filter((c): c is Candidate => !!c), ...cands].map(docCard).find(Boolean) : null;
  return d ? [...out, d] : out;
}
