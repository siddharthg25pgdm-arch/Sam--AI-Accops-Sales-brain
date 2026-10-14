/** The after-call summary: the whole labelled transcript -> OpenAI gpt-5.5 (LIVE_SUMMARY_MODEL), then Groq
 *  gpt-oss-120b, then gpt-oss-20b (120b has a daily token cap). Providers and order: lib/live/llm.ts. */
import { FRAMEWORK, KEYS, field, merge, progress, type Qualification } from "./framework";
import { verbatim } from "./insight";
import { chatJSON, firstAnswer, legs, parseJSON, strings } from "./llm";
import { mockOn, mockSummaryReply } from "./mock";
import { transcript, type Deal, type Detected, type Meeting, type Segment, type Summary } from "./store";

const SYSTEM = `You write the after-call summary for an Accops sales rep. Accops sells HySecure (ZTNA, secure remote access), HyWorks (VDI and DaaS), HyID (MFA and SSO), HyLabs (virtual labs), HyDesk thin clients and Browser Isolation.
In the transcript "Accops" is the rep and "Customer" is the customer. Use only what was said. Never invent facts, numbers, prices, dates, product capabilities or commitments.
Return JSON only, with exactly these keys:
{"overview":"","detected":{"company":"","contact_name":"","contact_title":""},"pains":[],"qualification":{"<key>":{"status":"open|partial|done","value":"","evidence":""}},"objections":[],"competitors":[],"next_steps":[],"follow_up_email":{"subject":"","body":""},"deal_score":0,"risks":[]}
- detected: the customer's organisation, and the name and job title of the person the rep spoke with, exactly as said in the call (e.g. "this is Priya from Sunrise Cooperative Bank" -> company "Sunrise Cooperative Bank", contact_name "Priya"). "" for anything not said. Never guess from context, an email domain or the Company line below.
- overview: two or three sentences: who they are, what they need, where it stands.
- pains, objections, risks: short plain sentences. competitors: every vendor the customer runs today or is evaluating, names only.
- next_steps: the actions agreed, with owner and date only where they were said.
- qualification: every field; done = clearly answered, partial = hinted. evidence = the customer's exact words from the transcript, "" when none.
- deal_score: 0 to 100, how qualified and how likely to progress, judged only from this call.
- follow_up_email: from the rep to the customer contact, first person, plain text, under 170 words. Address the contact by first name and sign off with the rep's first name, both given below; never write a placeholder in brackets. One line of thanks, then the two or three things they said matter, in their terms; the agreed next steps; the relevant Accops material by name. Concise and specific. No hype words, no exclamation marks, no prices, nothing that was not discussed.`;

/** ponytail: past 60k characters (about two hours of talk) the head and tail are kept; chunked
 *  summarising is the upgrade if calls run that long. */
const MAX_CHARS = 60_000;
export function callText(segs: Pick<Segment, "channel" | "text">[]): string {
  const all = transcript(segs);
  return all.length <= MAX_CHARS ? all : `${all.slice(0, 12_000)}\n[... the middle of the call is omitted ...]\n${all.slice(-(MAX_CHARS - 12_000))}`;
}

const line = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const para = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "");

export type Who = { contact: string | null; rep: string; company: string | null };

/** Models write "[Customer Name]" when they lack a name, even when told it. Known names go in; any other
 *  bracketed placeholder comes out, so a follow-up never reaches a customer with one. */
export function fillPlaceholders(s: string, who: Who): string {
  const first = who.contact?.trim().split(/\s+/)[0] ?? "";
  return s
    .replace(/\[(?:the )?(?:customer|client|contact|prospect|recipient)(?:'s)?(?: first| full)? name\]/gi, first)
    .replace(/\[(?:your|rep|sender|sales ?rep|accops rep|accops sales rep|account manager|my)(?:'s)?(?: first| full)? name\]/gi, who.rep)
    .replace(/\[(?:the )?(?:customer'?s? |client'?s? )?company(?: name)?\]/gi, who.company ?? "")
    .replace(/\b(Hi|Hello|Dear)\s+\[name\]/gi, (_, w: string) => `${w} ${first}`.trimEnd())
    .replace(/\[name\]/gi, who.rep)
    .replace(/\[[^\]\n]{1,60}\]/g, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "");
}

/** "siddharth.gupta" -> "Siddharth": how the follow-up email signs off. */
export const firstName = (id: string) => (id.split(/[.\-_ @]/)[0] || id).replace(/^./, c => c.toUpperCase());

/** Letters and digits only, lowercased: "Co-operative" and "cooperative" compare equal. */
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const NONE: Detected = { company: "", contact_name: "", contact_title: "" };

/** Who the customer said they are. A company or name that is not in the transcript (punctuation and case
 *  aside) is a guess and comes back "". The title is kept as read: people state it loosely ("I run IT"). */
export function readDetected(v: unknown, text: string): Detected {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const said = (x: string) => (x && squash(text).includes(squash(x)) ? x : "");
  const company = said(line(o.company, 160)), contact_name = said(line(o.contact_name, 120));
  return { company, contact_name, contact_title: contact_name || company ? line(o.contact_title, 120) : "" };
}

/** A model reply -> a Summary, or null when it is not usable (no overview or no email body), so the next
 *  model gets a turn. The qualification never goes backwards from what the call already had. */
export function readSummary(raw: string, prev: Qualification, text: string, who: Who): Summary | null {
  const o = parseJSON(raw);
  if (!o) return null;
  const mail = (o.follow_up_email && typeof o.follow_up_email === "object" ? o.follow_up_email : {}) as Record<string, unknown>;
  const overview = para(o.overview, 1500), body = fillPlaceholders(para(mail.body, 4000), who);
  if (!overview || !body) return null;
  const src = (o.qualification && typeof o.qualification === "object" ? o.qualification : {}) as Record<string, unknown>;
  const read: Qualification = {};
  for (const k of KEYS) if (src[k]) { const f = field(src[k]); read[k] = { ...f, evidence: verbatim(f.evidence, text) ? f.evidence : "" }; }
  const qualification = merge(prev, read);
  const score = Math.round(Number(o.deal_score));
  return {
    overview, pains: strings(o.pains, 6, 300), qualification, objections: strings(o.objections, 6, 300), competitors: strings(o.competitors, 6, 80),
    next_steps: strings(o.next_steps, 6, 300), follow_up_email: { subject: fillPlaceholders(line(mail.subject, 160), who), body },
    deal_score: Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : progress(qualification).pct, risks: strings(o.risks, 5, 300),
    detected: readDetected(o.detected, text),
  };
}

function prompt(m: Meeting, deal: Deal | null, text: string, who: Who) {
  const now = Object.fromEntries(KEYS.map(k => { const f = field(m.qualification[k]); return [k, f.status === "open" ? "open" : `${f.status}: ${f.value}`]; }));
  return [{ role: "system" as const, content: SYSTEM }, { role: "user" as const, content:
    `Rep (signs the email): ${who.rep}, Accops\nCustomer contact: ${who.contact ?? "name not given - open with a plain greeting"}${deal?.contact_title ? `, ${deal.contact_title}` : ""}`
    + `\nCompany: ${who.company ?? "not given"}\nCall date: ${new Date(m.started_at).toDateString()}`
    + `\n\nFields:\n${FRAMEWORK.map(f => `${f.key}: ${f.label} - ${f.hint}`).join("\n")}`
    + `\n\nQualification during the call: ${JSON.stringify(now)}\n\nTranscript:\n${text}` }];
}

/** Summarise a call by `deadline` (ms timestamp). Throws NoModel when every model failed; the meeting then
 *  stays live, so End can simply be pressed again. */
export async function summarise(m: Meeting, deal: Deal | null, segs: Segment[], deadline: number): Promise<Summary> {
  const text = callText(segs);
  if (!text.trim()) {
    return { overview: "Nothing was transcribed on this call, so there is nothing to summarise. Check that SAM Live could hear both sides.",
      pains: [], qualification: merge(m.qualification, null), objections: [], competitors: [], next_steps: [],
      follow_up_email: { subject: "", body: "" }, deal_score: progress(m.qualification).pct, risks: [], detected: NONE, model: "none" };
  }
  const who: Who = { contact: deal?.contact_name?.trim() || null, rep: firstName(m.owner), company: deal?.company ?? null };
  if (mockOn()) {
    const s = readSummary(mockSummaryReply(text, { rep: who.rep, company: who.company ?? "the customer", contact: who.contact }), m.qualification, text, who);
    if (s) return { ...s, model: "mock" };
    throw new Error("mock summary unreadable");
  }
  const msgs = prompt(m, deal, text, who);
  const { value, model } = await firstAnswer("summary", legs("summary"), deadline,
    async (l, ms) => readSummary(await chatJSON(l, msgs, { maxTokens: 2000, timeoutMs: ms }), m.qualification, text, who));
  return { ...value, model };
}
