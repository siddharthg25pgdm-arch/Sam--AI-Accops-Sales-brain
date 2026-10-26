/** The fact check on model-written answers (Siddharth, 27 Oct 2026). The model may phrase an answer, never add to it:
 *  every number (%, x multipliers, years, counts, number words), name (product, brand, competitor, customer, any
 *  organisation), certification / standard and quoted claim in the answer must appear in the texts of the records it
 *  cites (case-insensitive, punctuation and spacing ignored). Any miss -> the caller shows verified facts instead.
 *  Names: every capitalised word (a sentence's first word too, unless it is a common opener) plus the core.terms
 *  products / competitors / industries that the committed intent index already carries (label-level, any alias). */
import raw from "@/data/web-intent-index.json";

const ENTS = Object.entries((raw as unknown as { entities: Record<string, string[]> }).entities)
  .map(([label, aliases]) => [label, aliases.map(a => a.split(" "))] as const);
const WORD_NUM: Record<string, string> = { two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60",
  seventy: "70", eighty: "80", ninety: "90", hundred: "100", thousand: "1000", million: "1000000", billion: "1000000000",
  twice: "2x", double: "2x", triple: "3x", tenfold: "10x", half: "50%" }; // ponytail: "one"/"zero"/"single" left out ("one platform", "zero trust")
const OPENERS = new Set(("a an and as at because both but by each every for from here how if in instead it its many most no not now on " +
  "once or our rather since so some that the their there these they this those to today unlike when where whether which while with " +
  "within without yes you your we what who why all also any can only").split(" "));
const CERT = /\b(iso|soc\s*-?\s*[123]|gdpr|hipaa|pci\s*-?\s*dss|fedramp|nist|fips|common\s+criteria|cert\s*-?\s*in|stqc|rbi|sebi|irdai|dpdp|meity|csa\s+star|cmmc|ccpa|tisax|hitrust|cyber\s+essentials|eal\s*\d)\b/gi;

/** " lowercase words " with punctuation as spaces, so " x " finds whole words. No length cap (normalise() has one). */
const norm = (s: string) => ` ${s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
const has = (ev: string, phrase: string) => { const p = norm(phrase).trim(); return !p || ev.includes(` ${p} `) || ev.includes(` ${p}s `); };

/** Numbers as "40%", "10x" or "2022"; thousands commas dropped; number words as digits. */
function numbers(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)*)\s*(%|per\s?cent\b|percent\b|x\b|×|times\b)?/gi)) {
    const n = m[1].replace(/,(?=\d{3}(\D|$))/g, ""), u = m[2] ? (/^(x|×|times)$/i.test(m[2]) ? "x" : "%") : "";
    out.push(n + u);
  }
  for (const w of norm(s).trim().split(" ")) if (WORD_NUM[w]) out.push(WORD_NUM[w]);
  return out;
}

const entities = (s: string) => {
  const t = norm(s).trim().split(" ");
  return ENTS.filter(([, al]) => al.some(a => t.some((_, i) => a.every((w, k) => t[i + k] === w || t[i + k] === `${w}s` || t[i + k] === `${w}es`))))
    .map(([label]) => label);
};

/** Capitalised words: names, brands, customers, acronyms. A sentence's first word counts unless it is a common opener. */
function names(s: string): string[] {
  const out: string[] = [];
  for (const sentence of s.split(/(?<=[.!?:;])\s+/))
    sentence.split(/\s+/).forEach((w, i) => {
      for (const part of w.split(/[-/–]/)) { // "Hyper-V", "NetScaler/ADC", "HDX-specific": each capitalised part
        const t = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/i, "");
        if (!/\p{Lu}/u.test(t) || t === "Accops" || t === "I" || (i === 0 && OPENERS.has(t.toLowerCase()))) continue;
        out.push(t);
      }
    });
  return out;
}

/** What in `answer` the cited `evidence` does not support (empty = it passes). Markers are ignored. */
export function factCheck(answer: string, evidence: string[]): string[] {
  const a = answer.replace(/\*/g, ""), ev = norm(evidence.join(" \n ")), out: string[] = [];
  const evNums = new Set(numbers(evidence.join(" \n "))), bare = new Set([...evNums].map(n => n.replace(/[%x]$/, "")));
  for (const n of numbers(a)) if (!(evNums.has(n) || (!/[%x]$/.test(n) && bare.has(n)))) out.push(`number ${n}`);
  for (const t of names(a)) if (!has(ev, t)) out.push(`name ${t}`);
  const evEnts = new Set(entities(ev));
  for (const e of entities(a)) if (!evEnts.has(e)) out.push(`name ${e}`);
  for (const m of a.matchAll(CERT)) if (!has(ev, m[0])) out.push(`certification ${m[0]}`);
  for (const m of a.matchAll(/["“”«»]([^"“”«»]{2,200})["“”«»]/g)) if (!has(ev, m[1])) out.push(`quote "${m[1]}"`);
  if (/https?:|www\.|\]\(|\b[a-z0-9-]+\.(com|in|io|net|org)\b/i.test(a)) out.push("a link"); // answers stay in the chat
  return [...new Set(out)];
}

/** The visitor explicitly asks for a document: only then may a document card follow the answer (Siddharth, 27 Oct). */
export const docIntent = (q: string) =>
  /\b(brochures?|data\s?sheets?|pdfs?|white\s?papers?|decks?|case[\s-]stud(y|ies)|downloads?|send\s+me|e-?books?|one-?pagers?|solution\s+briefs?|documents?|documentation|docs)\b/i.test(q);
