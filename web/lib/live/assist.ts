/** The rep asks SAM mid-call (POST /api/live/meetings/:id/assist).
 *  - "next": no question. One line the rep can say now, from the transcript tail, the qualification and its
 *    open fields, plus up to two cards for what the customer just said.
 *  - "search": a typed question. SAM's collateral first; the web (OpenAI Responses API, web_search tool)
 *    only when SAM has no good match or the question wants a fresh outside fact. Web answers are marked
 *    unverified: the rep must not repeat them to a customer as Accops' word. */
import { blob, namedEntities, namesProduct, mentions, topicOf, typeGroup, type Asset } from "../cards";
import { defaultEffort } from "../agent-openai";
import { ready } from "../registry-cache";
import { redact } from "../redact";
import { COMPETITORS, FRAMEWORK, field, type Qualification } from "./framework";
import { cardsFor, readInsight, toCard, triggers, usableHits } from "./insight";
import { chatJSON, firstAnswer, legs, NoModel, parseJSON, strings, type Leg } from "./llm";
import { mockOn, mockInsightReply } from "./mock";
import { segments, transcript, type Card, type Meeting } from "./store";

export const INTENTS = ["discovery", "objection", "advance", "clarify", "rapport"] as const;
export type Intent = (typeof INTENTS)[number];
export type Say = { line: string; intent: Intent; why: string };
export type Web = { answer: string; sources: { title: string; url: string }[]; unverified: true };
/** `model`: who wrote the line or the web answer ("openai:gpt-5.4-mini", "mock", "none" = the framework's own
 *  question because no model answered, "sam" = collateral search only). */
export type Assist = { mode: "next" | "search"; say?: Say; cards: Card[]; web: Web | null; model: string };

const TAIL_CHARS = 2500;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const firstWords = (s: string, n: number) => s.split(" ").filter(Boolean).slice(0, n).join(" ");

const SYSTEM = `You are SAM Live, coaching an Accops sales rep during a live customer call. Accops sells HySecure (ZTNA, secure remote access), HyWorks (VDI and DaaS), HyID (MFA and SSO), HyLabs (virtual labs), HyDesk thin clients and Browser Isolation.
In the transcript "Accops" is the rep and "Customer" is the customer. The rep asked: what do I say next? Return JSON only:
{"say":{"line":"","intent":"discovery|objection|advance|clarify|rapport","why":""},"customer_questions":[],"competitors":[],"objections":[]}
- say.line: ONE thing the rep can say right now, in the rep's own voice, one or two short sentences, specific to what the customer just said. If the customer asked something or raised a concern, answer or handle it first; otherwise move an open field forward, or propose a next step once most fields are known. Never invent figures, prices, customer names or features; when unsure, offer to follow up.
- intent: discovery = asks about an open field; objection = handles a concern; advance = proposes a next step; clarify = checks understanding; rapport = builds the relationship.
- why: for the rep, at most 15 words.
- customer_questions, competitors, objections: only from the customer's LAST utterance, as short search phrases, e.g. "MFA for vendor access", "Citrix", "migration downtime". Empty arrays when there is nothing.`;

function nextPrompt(q: Qualification, tail: string) {
  const state = FRAMEWORK.map(f => { const v = field(q[f.key]); return `${f.key} (${f.label}): ${v.status === "open" ? `OPEN - ${f.hint}` : `${v.status}: ${v.value}`}`; }).join("\n");
  return [{ role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: `Qualification:\n${state}\n\nTranscript, most recent last:\n${tail || "(nothing said yet)"}` }];
}

/** A model reply -> the line and the last utterance's triggers, or null when there is no line to say. */
export function readNext(raw: string): { say: Say; customer_questions: string[]; competitors: string[]; objections: string[] } | null {
  const o = parseJSON(raw);
  const s = (o?.say && typeof o.say === "object" ? o.say : {}) as Record<string, unknown>;
  const line = str(s.line, 320);
  if (!o || !line) return null;
  const intent = (INTENTS as readonly string[]).includes(String(s.intent)) ? s.intent as Intent : "discovery";
  return { say: { line, intent, why: firstWords(str(s.why, 160), 15) },
    customer_questions: strings(o.customer_questions, 2), competitors: strings(o.competitors, 2, 60), objections: strings(o.objections, 2) };
}

/** No model answered: the framework's question for the first open field, or a nudge to a next step. */
export function fallbackLine(q: Qualification): Say {
  const f = FRAMEWORK.find(f => field(q[f.key]).status !== "done");
  return f ? { line: f.question, intent: f.key === "next_step" ? "advance" : "discovery", why: `Not covered yet: ${f.hint.toLowerCase()}.` }
    : { line: "What would be a sensible next step, and when?", intent: "advance", why: "Everything is covered: agree the next step." };
}

/** POST .../assist without a question. Within ~11 s; never throws for a model failure (falls back). */
export async function nextAssist(m: Meeting): Promise<Assist> {
  const warm = ready(); // SAM's collateral loads while the model thinks
  const segs = await segments(m.id, 40);
  const tail = transcript(segs, TAIL_CHARS);
  const lastCustomer = [...segs].reverse().find(s => s.channel === "customer")?.text ?? "";
  let r: NonNullable<ReturnType<typeof readNext>>, model: string;
  if (mockOn()) {
    const i = readInsight(mockInsightReply(lastCustomer ? `Customer: ${lastCustomer}` : ""), lastCustomer)!;
    r = { say: fallbackLine(m.qualification), customer_questions: i.customer_questions, competitors: i.competitors, objections: i.objections };
    model = "mock";
  } else {
    try {
      const msgs = nextPrompt(m.qualification, tail);
      ({ value: r, model } = await firstAnswer("assist", legs("assist"), Date.now() + 10_000, async (l, ms) => readNext(await chatJSON(l, msgs, { maxTokens: 400, timeoutMs: ms }))));
    } catch (e) {
      if (!(e instanceof NoModel)) throw e;
      console.error("live assist next failed", redact(e));
      r = { say: fallbackLine(m.qualification), customer_questions: [], competitors: [], objections: [] };
      model = "none";
    }
  }
  await warm;
  const cards = lastCustomer ? (await cardsFor(triggers(r), [])).slice(0, 2) : [];
  return { mode: "next", say: r.say, cards, web: null, model };
}

// Questions about what happened outside Accops lately, which collateral cannot answer however well it matches.
// ponytail: a word list; ask the model to route instead if reps' questions slip past it.
const FRESH = /\b(news|announc\w*|launch(ed|es)|this (year|quarter|month|week)|last (year|quarter|month|week)|20\d\d|today|yesterday|acqui\w*|merg\w*|funding|raised|revenue|earnings|stock|share price|ceo|layoffs?|outage|breach\w*|cve|vulnerabilit\w*|market share|gartner|forrester|idc|end of life|eol|rebrand\w*)\b/i;

/** A card is a good match when it names every vendor, product or regulation the question names and at least
 *  half the question's topic words. */
export function goodMatch(question: string, a: Asset): boolean {
  const b = blob(a), topic = topicOf(question);
  if (!namedEntities(question).every(e => mentions(b, e))) return false;
  return topic.filter(t => namesProduct(b, t)).length * 2 >= topic.length;
}

/** The web too: no shown card is a good match, or the question is about fresh outside facts. */
export function needsWeb(question: string, shown: Asset[]): boolean {
  return FRESH.test(question) || !shown.some(a => goodMatch(question, a));
}

const WEB_INSTRUCTIONS = `You help an Accops sales rep who is on a live customer call (Accops sells secure remote access, VDI/DaaS, MFA/SSO). Search the web and answer the rep's question in at most 80 words of plain text: no markdown, no links, no lists. Facts only, with dates where they matter. If the search does not answer it, say so in one sentence. Never guess.`;

/** A Responses API reply -> the web answer: the message text without inline citations, ≤ 80 words, and up
 *  to 3 distinct sources from its url_citation annotations. null when there is no text. */
export function readWeb(j: unknown): Web | null {
  const out = (j as { output?: { type?: string; content?: { type?: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[] }[] })?.output ?? [];
  const parts = out.filter(o => o.type === "message").flatMap(o => o.content ?? []).filter(c => c.type === "output_text");
  const text = parts.map(c => c.text ?? "").join(" ")
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#]+/g, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const words = text.split(" ");
  const answer = words.length > 80 ? `${words.slice(0, 80).join(" ").replace(/[,;:]$/, "")}…` : text;
  const sources: Web["sources"] = [];
  for (const a of parts.flatMap(c => c.annotations ?? [])) {
    if (a.type !== "url_citation" || !a.url || !/^https?:\/\//.test(a.url)) continue;
    const u = new URL(a.url);
    u.searchParams.delete("utm_source");
    const url = u.toString();
    if (sources.length < 3 && !sources.some(s => s.url === url)) sources.push({ title: str(a.title, 160) || u.hostname, url });
  }
  return { answer, sources, unverified: true };
}

async function webOnce(l: Leg, question: string, timeoutMs: number): Promise<Web | null> {
  const effort = defaultEffort(l.model);
  const r = await fetch(`${l.p.base}/responses`, {
    method: "POST", headers: { Authorization: `Bearer ${l.p.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: l.model, tools: [{ type: "web_search" }], instructions: WEB_INSTRUCTIONS, input: question, store: false,
      max_output_tokens: effort && effort !== "none" ? 2500 : 600, ...(effort ? { reasoning: { effort } } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(redact(`${r.status}: ${(await r.text()).slice(0, 200)}`));
  return readWeb(await r.json());
}

/** POST .../assist with a question. Within ~24 s. */
export async function searchAssist(question: string): Promise<Assist> {
  const deadline = Date.now() + 23_000;
  await ready();
  // A question naming a competitor wants the battlecard first; otherwise search order.
  const rival = namedEntities(question).some(e => COMPETITORS.has(e));
  const hits = usableHits(question).sort((a, b) => rival ? Number(typeGroup(b) === "Battlecard") - Number(typeGroup(a) === "Battlecard") : 0);
  const top = hits.slice(0, 3), cards = top.map(a => toCard(question, a));
  const ls = legs("web");
  if (mockOn() || !ls.length || !needsWeb(question, top)) return { mode: "search", cards, web: null, model: "sam" };
  try {
    const { value, model } = await firstAnswer("web", ls, deadline, (l, ms) => webOnce(l, question, ms));
    return { mode: "search", cards, web: value, model };
  } catch (e) {
    console.error("live assist web failed", redact(e));
    return { mode: "search", cards, web: null, model: "sam" };
  }
}
