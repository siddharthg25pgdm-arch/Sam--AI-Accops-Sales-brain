/** The live insight: after a stored utterance, at most once per 12 s per meeting, read the transcript tail,
 *  move the qualification forward, suggest what to ask next, and pull collateral for what the customer
 *  raised. Fails quietly: an insight is a bonus on top of the transcript, never a reason to lose it. */
import { searchAssets, assetLink, describe, typeGroup, trustNote, namedEntities, mentions, ENTITIES } from "../cards";
import { ready } from "../registry-cache";
import { redact } from "../redact";
import { FRAMEWORK, KEYS, COMPETITORS, field, merge, cueOf, type Qualification } from "./framework";
import { chatJSON, firstAnswer, legs, parseJSON, strings } from "./llm";
import { mockOn, mockInsightReply } from "./mock";
import { claimInsight, patchMeeting, segments, transcript, type Ask, type Card } from "./store";

export const EVERY_MS = 12_000;
const TAIL_CHARS = 2500;
/** `model` = which provider:model answered ("openai:gpt-5.4-mini", "groq:openai/gpt-oss-20b", "mock"). */
export type Insight = { qualification: Qualification; ask_next: Ask[]; battlecards: Card[]; alerts: string[]; model: string };

const SYSTEM = `You are SAM Live, a silent copilot for an Accops sales rep during a live customer call. Accops sells HySecure (ZTNA, secure remote access), HyWorks (VDI and DaaS), HyID (MFA and SSO), HyLabs (virtual labs), HyDesk thin clients and Browser Isolation.
In the transcript "Accops" is the rep and "Customer" is the customer. Return JSON only:
{"qualification":{"<key>":{"status":"open|partial|done","value":"","evidence":""}},"ask_next":[{"key":"","question":"","why":""}],"customer_questions":[],"competitors":[],"objections":[],"alerts":[]}
- qualification: only fields that change or get more specific, from what the CUSTOMER said. done = clearly answered, partial = hinted or vague. value = the answer in a few words. evidence = the customer's exact words copied from the transcript. Never guess.
- ask_next: up to 3 questions for fields still open or partial, worded as the rep would say them, most useful first. Never one the rep has just asked.
- customer_questions: questions the customer asked, each as a short search phrase, e.g. "MFA for vendor access".
- competitors: every vendor the customer runs today or is evaluating, e.g. Citrix, Omnissa, AVD. Not Accops.
- objections: concerns the customer raised, each as a short phrase, e.g. "migration downtime".
- alerts: at most 2 things the rep must not miss right now (a deadline, a red flag); usually none.
Short strings. Empty arrays when there is nothing.`;

function prompt(q: Qualification, tail: string) {
  const fields = FRAMEWORK.map(f => `${f.key}: ${f.label} - ${f.hint}`).join("\n");
  const now = Object.fromEntries(KEYS.map(k => { const f = field(q[k]); return [k, f.status === "open" ? "open" : `${f.status}: ${f.value}`]; }));
  return [{ role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: `Fields:\n${fields}\n\nQualification so far: ${JSON.stringify(now)}\n\nTranscript, most recent last:\n${tail}` }];
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Same words in the same order, case and punctuation aside: an evidence quote must really be in the transcript. */
export function verbatim(quote: string, text: string): boolean {
  const n = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  return n(quote).trim().length > 0 && n(text).includes(n(quote));
}

/** A model reply -> what SAM uses, or null when it is not JSON even after repair. Evidence that is not in
 *  `tail` is dropped (the field keeps its status; merge() then keeps any earlier quote). */
export function readInsight(raw: string, tail: string) {
  const o = parseJSON(raw);
  if (!o) return null;
  const src = (o.qualification && typeof o.qualification === "object" ? o.qualification : {}) as Record<string, unknown>;
  const qualification: Qualification = {};
  for (const k of KEYS) {
    if (!src[k]) continue;
    const f = field(src[k]);
    qualification[k] = { ...f, evidence: verbatim(f.evidence, tail) ? f.evidence : "" };
  }
  const ask_next: Ask[] = (Array.isArray(o.ask_next) ? o.ask_next : [])
    .map((a: Record<string, unknown>) => ({ key: str(a?.key, 40), question: str(a?.question, 200), why: str(a?.why, 160) }))
    .filter(a => KEYS.includes(a.key) && a.question);
  return { qualification, ask_next, customer_questions: strings(o.customer_questions, 3), competitors: strings(o.competitors, 3, 60),
    objections: strings(o.objections, 3), alerts: strings(o.alerts, 2) };
}

/** At most 3, for fields not done, never about what the rep's last utterance just asked. When the model
 *  offers nothing usable, the framework's own question for the first open fields. */
export function nextQuestions(proposed: Ask[], q: Qualification, lastRep: string): Ask[] {
  const fresh = (k: string) => field(q[k]).status !== "done" && !cueOf(k)?.test(lastRep);
  const out: Ask[] = [];
  for (const a of proposed) if (fresh(a.key) && !out.some(o => o.key === a.key)) out.push(a);
  if (!out.length) for (const f of FRAMEWORK) if (out.length < 3 && fresh(f.key)) out.push({ key: f.key, question: f.question, why: `Not covered yet: ${f.hint.toLowerCase()}.` });
  return out.slice(0, 3);
}

type Trigger = { kind: "competitor" | "question" | "objection"; text: string };
// Which collateral answers which moment: a competitor wants the battlecard, a question the datasheet
// (typeGroup "Brochure"), an objection a customer who had the same worry. Nothing else: event and
// partner decks match on any keyword and are an hour long, so mid-call they are noise (the first real
// run showed a European value proposition and a 72-slide customer deck for a bank's pricing remark).
const PREFER: Record<Trigger["kind"], string[]> = {
  competitor: ["Battlecard", "Case Study", "Whitepaper", "Brochure"],
  question: ["Brochure", "Case Study", "Battlecard", "Whitepaper"],
  objection: ["Case Study", "Battlecard", "Brochure", "Whitepaper"],
};

/** The competitor a name is about, by whichever vendor it names first: "Citrix Virtual Apps" -> Citrix,
 *  "Omnissa Horizon" -> Omnissa (not VMware, whose Horizon it was). Anything else comes back as given. */
export function vendor(s: string): string {
  const low = s.toLowerCase(), at = (e: string) => Math.min(...ENTITIES[e].map(w => low.indexOf(w)).filter(i => i >= 0));
  return namedEntities(s).filter(e => COMPETITORS.has(e)).sort((a, b) => at(a) - at(b))[0] ?? s;
}

export function triggers(r: { competitors: string[]; customer_questions: string[]; objections: string[] }): Trigger[] {
  const names = [...new Set(r.competitors.filter(c => !/accops|^hy(secure|works|id|labs|desk)/i.test(c)).map(vendor))];
  return [
    ...names.map(text => ({ kind: "competitor" as const, text })),
    ...r.customer_questions.map(text => ({ kind: "question" as const, text })),
    ...r.objections.map(text => ({ kind: "objection" as const, text })),
  ];
}

/** Up to three cards for what the customer raised, from SAM's own collateral search (in process): the
 *  preferred type among the matches (PREFER), public link when one exists, else the internal one. Never
 *  a card, or a trigger, already shown in this meeting; never an expired document; no card for a
 *  competitor a card already shown is about. */
export async function cardsFor(ts: Trigger[], shown: Card[]): Promise<Card[]> {
  if (!ts.length) return [];
  await ready();
  const seen = new Set(shown.flatMap(c => [c.title, c.link ?? "", `t:${c.trigger}`]).filter(Boolean).map(s => s.toLowerCase()));
  const out: Card[] = [];
  for (const t of ts) {
    if (out.length >= 3) break;
    if (seen.has(`t:${t.text.toLowerCase()}`)) continue;
    if (t.kind === "competitor" && [...shown, ...out].some(c => mentions(c.title, t.text))) continue;
    const hits = searchAssets({ query: t.kind === "competitor" ? `${t.text} battlecard` : t.text, limit: 8 }).results.map(h => h.asset)
      .filter(a => assetLink(a) && !seen.has(a.title.toLowerCase()) && !seen.has(assetLink(a)!.toLowerCase()) && !/^EXPIRED/.test(trustNote(a) ?? ""));
    const a = PREFER[t.kind].map(type => hits.find(h => typeGroup(h) === type)).find(Boolean);
    if (!a) continue;
    const card: Card = { trigger: t.text, title: a.title, brief: describe(a), link: assetLink(a), shareable: Boolean(a.public_url) };
    out.push(card);
    for (const s of [card.title, card.link ?? "", `t:${card.trigger}`]) if (s) seen.add(s.toLowerCase());
  }
  return out;
}

/** Run one insight if this meeting's slot is free; null when it is not, or anything failed. */
export async function maybeInsight(meetingId: string): Promise<Insight | null> {
  try {
    const m = await claimInsight(meetingId, EVERY_MS);
    if (!m) return null;
    const segs = await segments(meetingId, 40);
    const tail = transcript(segs, TAIL_CHARS);
    const msgs = prompt(m.qualification, tail);
    const { value: r, model } = mockOn() ? { value: readInsight(mockInsightReply(tail), tail)!, model: "mock" }
      // A reply that is not JSON even after repair counts as a failure, so the next model gets a turn.
      : await firstAnswer("insight", legs("insight"), Date.now() + 11_000, async (l, ms) => readInsight(await chatJSON(l, msgs, { maxTokens: 900, timeoutMs: ms }), tail));
    const qualification = merge(m.qualification, r.qualification);
    const lastRep = [...segs].reverse().find(s => s.channel === "rep")?.text ?? "";
    const ask_next = nextQuestions(r.ask_next, qualification, lastRep);
    const battlecards = await cardsFor(triggers(r), m.battlecards ?? []);
    // Only while live: an insight landing after End must not overwrite the summary's qualification.
    await patchMeeting(meetingId, { qualification, suggestions: ask_next, battlecards: [...(m.battlecards ?? []), ...battlecards] }, "status=eq.live");
    return { qualification, ask_next, battlecards, alerts: r.alerts, model };
  } catch (e) {
    console.error("live insight failed", redact(e));
    return null;
  }
}
