// Tier 1 (plan 3.2): deterministic intent matcher over the committed index. No model, no network, about 0.1 ms.
// The index is built offline by prototype/build_intent_index.py; every step here mirrors its Matcher class line
// for line, and web/data/web-intent-golden.json (checked by lib/web-intent.check.mjs) proves the two agree.
// The caller must still confirm the returned qa_id is live in sam_web_qa_public (a retired pair is skipped).
import raw from "@/data/web-intent-index.json";
import type { IntentMatch } from "./contracts";
import { normalise } from "./normalise";

type Intent = { qa_id: string; groups: string[]; must: string[]; allow: string[]; keywords: Record<string, number>; phrases: string[]; min_score: number };
type Index = { stop: string[]; synonyms: Record<string, string>; entities: Record<string, string[]>; group_entities: Record<string, string[]>;
  vocab: string[]; w_kw: number; unk: number; intents: Intent[]; margin: number };

const ix = raw as unknown as Index;
const ASCII_WORD = /^[a-z]+$/;
// Maps, not objects: a visitor typing "constructor" must not hit Object.prototype.
const stop = new Set(ix.stop);
const syn = new Map(Object.entries(ix.synonyms));
const vocabSet = new Set(ix.vocab);
const ents = Object.entries(ix.entities).map(([label, aliases]) => [label, aliases.map(a => a.split(" "))] as const);
const kws = ix.intents.map(it => new Map(Object.entries(it.keywords)));
const idf = new Map<string, number>();
for (const k of kws) for (const [t, w] of k) idf.set(t, w);
const unk = ix.unk * Math.max(...idf.values());
const groupEnts = new Map(Object.entries(ix.group_entities));

export function stem(t: string): string {
  if (!ASCII_WORD.test(t)) return t;
  for (const suf of ["ing", "ed", "es", "s"]) {
    if (t.length >= suf.length + 4 && t.endsWith(suf)) {
      if (!(suf === "s" && t.endsWith("ss"))) t = t.slice(0, -suf.length);
      break;
    }
  }
  t = t.slice(0, 6);
  return t.length > 4 && t.endsWith("e") ? t.slice(0, -1) : t;
}

function osa(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

function fix(t: string): string {
  const s = syn.get(t);
  if (s !== undefined) return s;
  if (vocabSet.has(t) || stop.has(t) || t.length < 5 || !ASCII_WORD.test(t)) return t;
  let best = t, bd = 3;
  for (const v of ix.vocab) {
    if (Math.abs(v.length - t.length) > 1 || !ASCII_WORD.test(v)) continue;
    const dist = osa(t, v);
    if (dist < bd) { best = v; bd = dist; }
  }
  return bd <= (t.length >= 9 ? 2 : 1) ? best : t;
}

function entities(toks: string[]): string[] {
  const found: string[] = [];
  for (const [label, aliases] of ents) {
    const hit = aliases.some(a => {
      for (let i = 0; i + a.length <= toks.length; i++)
        if (a.every((w, k) => toks[i + k] === w || toks[i + k] === w + "s" || toks[i + k] === w + "es")) return true;
      return false;
    });
    if (hit) found.push(label);
  }
  return found;
}

export function analyse(text: string, fuzzy = true) {
  const normalised = normalise(text);
  const tokens = normalised ? normalised.split(" ").map(t => (fuzzy ? fix(t) : syn.get(t) ?? t)) : [];
  const terms: string[] = [];
  for (const t of tokens) if (!stop.has(t)) { const s = stem(t); if (!terms.includes(s)) terms.push(s); }
  return { normalised, tokens, terms, entities: entities(tokens) };
}

const phraseTerms = ix.intents.map(it => it.phrases.map(p => analyse(p, false).terms));

export function rank(text: string, group: string): { score: number; n: number }[] {
  const { terms: q, entities: named } = analyse(text);
  const have = new Set([...named, ...(groupEnts.get(group) ?? [])]);
  let qw = 0;
  for (const t of q) qw += idf.get(t) ?? unk;
  const out: { score: number; n: number }[] = [];
  if (qw === 0) return out;
  ix.intents.forEach((it, n) => {
    if (!it.groups.includes(group)) return;
    if (it.must.length && !it.must.some(e => have.has(e))) return;
    if (named.some(e => !it.allow.includes(e))) return; // the visitor names a product/vendor this answer does not cover
    const kw = kws[n];
    let m = 0;
    for (const t of q) { const w = kw.get(t); if (w !== undefined) m += w; }
    if (m === 0) return;
    let ph = 0;
    for (const pt of phraseTerms[n]) {
      let hit = 0, tot = 0;
      for (const t of pt) { const w = kw.get(t)!; tot += w; if (q.includes(t)) hit += w; }
      if (tot > 0 && hit / tot > ph) ph = hit / tot;
    }
    out.push({ score: ix.w_kw * (m / qw) + (1 - ix.w_kw) * ph, n });
  });
  return out.sort((a, b) => b.score - a.score || a.n - b.n);
}

/** The matcher's ranked pairs for this page group (no confidence gate): follow-up chips when the answer has fewer than
 *  2 (Siddharth, 27 Oct). The index may hold drafts, so the caller keeps only ids live in sam_web_qa_public. */
export const related = (text: string, page_group: string, n = 5) => rank(text, page_group).slice(0, n).map(r => ix.intents[r.n].qa_id);

export const intentMatch: IntentMatch = (text, page_group) => {
  const r = rank(text, page_group);
  if (!r.length) return null;
  const top = r[0].score, second = r.length > 1 ? r[1].score : 0;
  const margin = (top - second) / top;
  const it = ix.intents[r[0].n];
  return top >= it.min_score && margin >= ix.margin ? { qa_id: it.qa_id, score: top, margin } : null;
};
