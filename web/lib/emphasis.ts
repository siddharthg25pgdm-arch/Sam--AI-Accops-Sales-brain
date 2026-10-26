/** Emphasis in visitor text (Siddharth, 27 Oct 2026: signalling): `**phrase**` marks the few words a skimming reader
 *  needs. Limits: at most 4 phrases, each at most 6 words, emphasised words at most 35% of the text's words.
 *  No imports: the widget renders with emSplit, the server cleans model text with emClean, and
 *  prototype/load_web_knowledge.py mirrors emProblems to REJECT a bank answer that breaks a rule. */
export const EM = { phrases: 4, words: 6, share: 0.35 } as const;

// A pair: ** + no space or * right inside the markers + **, on one line. Anything else with an asterisk is stray.
const PAIR = /\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*/g;
const count = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** -> [plain, emphasised, plain, ...]: odd indices are emphasised. Stray asterisks stay as typed (the server cleans). */
export const emSplit = (s: string) => s.split(PAIR);

/** What breaks the rules (empty = fine). The bank loader rejects on any of these. */
export function emProblems(s: string): string[] {
  const out: string[] = [], phrases = [...s.matchAll(PAIR)].map(m => m[1]);
  if (s.replace(PAIR, "$1").includes("*")) out.push("unbalanced or nested ** markers");
  if (phrases.length > EM.phrases) out.push(`${phrases.length} emphasised phrases (max ${EM.phrases})`);
  for (const p of phrases) if (count(p) > EM.words) out.push(`"${p}" is ${count(p)} words (max ${EM.words})`);
  const w = phrases.reduce((k, p) => k + count(p), 0), total = count(s.replace(/\*/g, ""));
  if (total && w > EM.share * total) out.push(`${w} of ${total} words emphasised (max ${Math.round(EM.share * 100)}%)`);
  return out;
}

/** Model text: keep the valid pairs in order while they fit the limits; every other marker goes, the words stay. */
export function emClean(s: string): string {
  const total = count(s.replace(/\*/g, ""));
  let n = 0, w = 0;
  return s.replace(/[\u0001\u0002]/g, "")
    .replace(PAIR, (_m, p: string) => {
      const k = count(p);
      if (n >= EM.phrases || k > EM.words || w + k > EM.share * total) return p;
      n++; w += k;
      return `\u0001${p}\u0002`;
    })
    .replace(/\*/g, "").replace(/[\u0001\u0002]/g, "**");
}
