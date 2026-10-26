/** POST /api/web/ask, in the order of plan 3.3: validate -> classify -> admit -> pre-guard -> tier 0 bank /
 *  tier 1 intent -> tier 2 cache -> [human, model on, candidates, a slot] tier 3 model (text-first since 27 Oct:
 *  a written answer, fact-checked, else verified facts) -> cache put -> log. Cheapest first; bots and suspects never
 *  reach the model. Every answer ends with follow-up chips when approved pairs exist. Logging is returned as a
 *  callback the route runs after the response (it never blocks the answer). */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Answer, type Chip } from "@/lib/blocks";
import { redact } from "@/lib/redact";
import { classify, isTestConv } from "@/lib/web/bot";
import { admit } from "@/lib/web/limits";
import { preGuard } from "@/lib/web/guard";
import { cacheGet, cachePut } from "@/lib/web/cache";
import { intentMatch, related } from "@/lib/web/intent";
import type { Ctx, Label, Source } from "./contracts";
import * as db from "./db";
import { docIntent } from "./facts";
import { LEAD, chips, cleanPage, compose, cta, facts, qaBlocks, qaId } from "./fill";
import { MAX_CANDS, writeAnswer } from "./model";
import { qHash } from "./normalise";

const Id = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
const Body = z.object({
  conversation_id: Id, visitor_id: Id, page: z.string().max(500), hs: z.string().max(400).nullish(),
  parent: z.boolean(), ms_since_render: z.number().finite().min(0), recent_ms: z.array(z.number().finite()).max(6),
  prev: z.string().max(200).optional(),
  turn: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("click"), qa_id: Id }),
    z.object({ kind: z.literal("typed"), text: z.string().trim().min(1).max(500) }), // above 500 is rejected, not truncated
  ]),
});

export type Out = { status: number; body: Record<string, unknown>; log: (() => Promise<void>) | null };
const json = (status: number, body: Record<string, unknown>): Out => ({ status, body, log: null });
const UNAVAILABLE = { error: "unavailable" };

const sameOrigin = (req: Request) => {
  const o = req.headers.get("origin");
  return !!o && URL.canParse(o) && new URL(o).host === new URL(req.url).host && req.headers.get("sec-fetch-site") === "same-origin";
};

const evalToken = (req: Request) => {
  const want = process.env.WEB_EVAL_TOKEN, got = req.headers.get("x-sam-eval");
  if (!want || !got) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(want), h(got));
};

/** sha256(ip + HMAC(WEB_IP_SALT, IST date)): a daily-salted hash, the raw IP is never stored (plan 6). */
export function ipHash(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const salt = createHmac("sha256", process.env.WEB_IP_SALT ?? "").update(day).digest("hex");
  return createHash("sha256").update(ip + salt).digest("hex");
}

export async function ask(req: Request): Promise<Out> {
  const t0 = Date.now();
  if (!db.webReady()) return json(503, UNAVAILABLE);
  const ev = evalToken(req);
  if (!sameOrigin(req) && !ev) return json(403, { error: "forbidden" });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid request" });
  const b = parsed.data, turn = b.turn;

  let s: db.Settings, page_group: string;
  const page = cleanPage(b.page);
  try { s = await db.settings(); page_group = page ? await db.pageGroup(page) : "general"; }
  catch (e) { console.warn(`web ask: ${redact(e)}`); return json(503, UNAVAILABLE); } // migrations not applied yet, or the DB is down
  if (!s?.enabled) return json(503, UNAVAILABLE);

  const ctx: Ctx = { conversation_id: b.conversation_id, visitor_id: b.visitor_id, page, page_group,
    country: req.headers.get("x-vercel-ip-country"), ip_hash: ipHash(req), ua: req.headers.get("user-agent") ?? "",
    kind: turn.kind, hs: b.hs ?? null, parent: b.parent, ms_since_render: b.ms_since_render, recent_ms: b.recent_ms, eval: ev };
  const text = turn.kind === "typed" ? turn.text : null;
  const q_hash = text ? qHash(text, page_group) : null;
  const message_id = randomUUID();
  const m: Record<string, unknown> = { id: message_id, turn_kind: turn.kind, qa_id: turn.kind === "click" ? turn.qa_id : null,
    question: text, q_hash, verdict: null, refs: [], candidates: 0, model: null, tokens: 0, error: null, guard_reason: null };
  let label: Label = "bot", signals: string[] = [];

  const rootChips = async () => chips(await db.roots(page).catch(() => []));
  const fallback = async (c?: Chip[]) => ({ lead: LEAD.none, blocks: [cta(s)], chips: c ?? await rootChips() });
  /** Follow-up chips after every answer (Siddharth, 27 Oct): `first` (a pair's children / the model's picks), then while
   *  fewer than 2, the intent matcher's next-best APPROVED pairs (`ok` = those of `rel` live in sam_web_qa_public),
   *  then the page's roots. None only when nothing is approved. */
  const more = async (first: db.QaRef[], rel: string[], skip: string[], ok: Map<string, db.Qa>) => {
    let rows = first;
    if (chips(rows, skip).length < 2) rows = [...rows, ...rel.map(id => ok.get(id)).filter((q): q is db.Qa => !!q)];
    if (chips(rows, skip).length < 2) rows = [...rows, ...(await db.roots(page).catch(() => []))];
    return chips(rows, skip);
  };
  /** A pair as an answer: verbatim text + visual, its follow-ups as chips, a CTA when it carries one or later in the chat. */
  const bank = async (id: string) => {
    const qa = (await db.qas([id])).get(id);
    if (!qa) return null; // retired or never approved
    const blocks = qaBlocks(qa);
    if ((qa.cta_url || b.recent_ms.length >= 2) && !blocks.some(x => x.type === "cta")) blocks.push(cta(s, qa));
    const rel = related(qa.question, page_group).filter(x => x !== id);
    const [kids, ok] = await Promise.all([db.children(id).catch(() => []), // in parallel: no added latency
      rel.length ? db.qas(rel).catch(() => new Map<string, db.Qa>()) : new Map<string, db.Qa>()]);
    return { blocks, chips: await more(kids, rel, [id], ok) };
  };

  const finish = async (source: Source, a: unknown, status = 200): Promise<Out> => {
    let out = Answer.safeParse(a), src = source;
    if (!out.success) { m.error = "fill"; src = "fallback"; out = Answer.safeParse(await fallback()); }
    const answer = out.success ? out.data : { lead: LEAD.none, blocks: [], chips: [] };
    const log = { ...m, source: src, label, signals, conversation_id: ctx.conversation_id, visitor_id: ctx.visitor_id, page,
      page_group, country: ctx.country, is_test: ev || isTestConv(ctx.hs, ctx.conversation_id), latency_ms: Date.now() - t0 };
    return { status, body: { message_id, source: src, ...answer },
      log: () => db.logMessage(log).then(() => undefined, e => console.warn(`web log: ${redact(e)}`)) };
  };

  try {
    ({ label, signals } = await classify(req, ctx));
    const adm = ev ? null : await admit(ctx, turn.kind, q_hash); // the eval token skips per-visitor limits, never the ceiling
    if (adm === "rate") return finish("limited", { lead: LEAD.limited, blocks: [cta(s)], chips: await rootChips() }, 429);
    if (adm === "repeat") return finish("repeat", { lead: LEAD.repeat, blocks: [cta(s)], chips: [] });

    if (turn.kind === "click") { // tier 0
      const a = await bank(turn.qa_id);
      return a ? finish("bank", a) : finish("fallback", await fallback());
    }
    const g = preGuard(turn.text);
    if (g) { m.guard_reason = g.reason; return finish("guard", g.answer); } // the rule name only, never the text

    const hit = intentMatch(turn.text, page_group); // tier 1
    if (hit) { const a = await bank(hit.qa_id); if (a) { m.qa_id = hit.qa_id; return finish("intent", a); } }

    const cached = await cacheGet(q_hash!); // tier 2
    if (cached) return finish("cache", cached);

    // Gate for tier 3: human only, model on (env and settings), candidates, and a slot (taken inside writeAnswer).
    if (label !== "human" || process.env.WEB_MODEL_OFF === "1" || !s.model_enabled) return finish("fallback", await fallback());
    const cands = (await db.search(turn.text, page_group, MAX_CANDS)).slice(0, MAX_CANDS);
    m.candidates = cands.length;
    if (!cands.length) return finish("fallback", await fallback());
    const q = b.prev ? `${turn.text}\n(Their previous question: ${b.prev})` : turn.text;
    const rel = related(turn.text, page_group), doc = docIntent(turn.text);
    // One read, alongside the model call, for every pair this answer may show: the candidates' (visual, verified
    // facts) and the follow-ups'.
    const [w, pairs] = await Promise.all([writeAnswer(q, cands),
      db.qas([...new Set([...cands.filter(c => c.kind === "qa").map(c => qaId(c.ref)), ...rel])]).catch(() => new Map<string, db.Qa>())]);
    if (!w) { // no slot, or both providers failed: verified facts; not cached (the next ask may reach the model)
      m.error = "model";
      const blocks = facts([], cands, pairs, doc);
      const next = await more([], rel, [], pairs);
      return finish("fallback", blocks.length ? { lead: LEAD.facts, blocks: [...blocks, cta(s)], chips: next } : await fallback(next));
    }
    Object.assign(m, { verdict: w.verdict, model: w.model, tokens: w.tokens, refs: w.cites });

    const cited = w.cites.filter(r => r.startsWith("qa:")).map(qaId);
    const picks = w.followups.map(id => pairs.get(id)).filter((x): x is db.Qa => !!x); // the model's follow-ups, approved only
    const next = await more(picks, rel, cited, pairs);
    let a: Answer, source: Source = "model";
    if (w.verdict === "none") { a = await fallback(next); source = "fallback"; }
    else {
      const c = compose(w, cands, pairs, doc);
      let blocks = c.blocks, lead: string | undefined = w.verdict === "partial" ? LEAD.partial : undefined;
      if (c.problems.length) { // the written answer may not be shown: verified facts instead; the log says what failed
        m.error = `fact_check: ${c.problems.join("; ")}`.slice(0, 200);
        blocks = facts(w.cites, cands, pairs, doc);
        lead = LEAD.facts;
      }
      if (!blocks.length) { a = await fallback(next); source = "fallback"; }
      else {
        const top = cited.map(id => pairs.get(id)).find(Boolean);
        if (lead || top?.cta_url || b.recent_ms.length >= 2) blocks.push(cta(s, top));
        a = { ...(lead ? { lead } : {}), blocks, chips: next };
      }
    }
    // Every tier-3 outcome is shared, including "none" and a failed fact check, so a repeated question costs one model call (plan 2.4).
    const ok = Answer.safeParse(a);
    if (ok.success) await cachePut(q_hash!, page_group, ok.data, source).catch(e => console.warn(`web cache put: ${redact(e)}`));
    return finish(source, a);
  } catch (e) {
    console.warn(`web ask: ${redact(e)}`);
    m.error = "server";
    return finish("fallback", await fallback().catch(() => ({ lead: LEAD.none, blocks: [cta(s)], chips: [] })));
  }
}
