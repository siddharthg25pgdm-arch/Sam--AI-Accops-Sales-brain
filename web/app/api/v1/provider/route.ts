import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { tiers, requestBody, keyProblems, type Tier } from "@/lib/agent-openai";
import { redact } from "@/lib/redact";
import { legs, label, type Job, type Provider } from "@/lib/live/llm";
import { mockOn } from "@/lib/live/mock";

/** GET /api/v1/provider (admin cookie or API token; a rep's cookie gets 403): which model providers are configured, in the order SAM
 *  tries them, whether each configured model exists for the key and answers a real SAM-shaped request
 *  (same body builder as ask(), tools included, so a model that cannot tool-call fails here, not in front
 *  of a rep). `live` is SAM Live's models per job, in the order tried, each checked against /models. Server
 *  side only: the key never leaves the function; only its last 4 characters are shown. */
export async function GET(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  if (who.via === "cookie" && !who.admin) return Response.json({ error: "Admins only." }, { status: 403 });
  const ts = tiers();
  const claude = process.env.ANTHROPIC_API_KEY ? (process.env.CLAUDE_MODEL ?? "claude-sonnet-5") : null;
  const order = [...ts.flatMap(t => t.models.map(m => `${m} (${t.provider})`)), ...(claude ? [`${claude} (anthropic)`] : []), "retrieval only"];
  const out: Record<string, unknown> = {
    // Kept for older callers: the first provider and model SAM will use.
    provider: ts[0]?.provider ?? (claude ? "anthropic" : "none"), model: ts[0]?.models[0] ?? claude,
    order, tiers: await Promise.all(ts.map(check)), live: await checkLive(),
    // A set-but-malformed key (pasted twice, line breaks) is skipped, not sent. Said here, never echoed.
    ...(keyProblems().length ? { key_problems: keyProblems() } : {}),
  };
  // Last line of defence: nothing key-shaped leaves this route, whatever produced it.
  return new Response(redact(out), { headers: { "Content-Type": "application/json" } });
}

/** SAM Live: each job's models in the order tried (lib/live/llm.ts) and whether each exists for its key,
 *  from one GET /models per provider. No audio and no prompt is sent. */
async function checkLive() {
  const lists = new Map<string, Promise<Set<string> | string>>();
  const ids = (p: Provider) => {
    if (!lists.has(p.base)) lists.set(p.base, fetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${p.key}` }, signal: AbortSignal.timeout(10_000) })
      .then(async r => r.ok ? new Set<string>(((await r.json()).data ?? []).map((m: { id: string }) => m.id)) : `HTTP ${r.status}`)
      .catch(e => redact(e)));
    return lists.get(p.base)!;
  };
  const job = (j: Job) => Promise.all(legs(j).map(async l => {
    const got = await ids(l.p);
    return { model: label(l), base_url: l.p.base, key: `...${l.p.key.slice(-4)}`, ...(typeof got === "string" ? { models_error: got } : { available: got.has(l.model) }) };
  }));
  return { mock: mockOn(), stt: await job("stt"), insight: await job("insight"), summary: await job("summary") };
}

async function check(t: Tier) {
  const auth = { Authorization: `Bearer ${t.key}` };
  const res: Record<string, unknown> = { provider: t.provider, base_url: t.base, key: `...${t.key.slice(-4)}`, models: t.models };
  try {
    const r = await fetch(`${t.base}/models`, { headers: auth, signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    if (r.ok) {
      const ids = new Set<string>((j.data ?? []).map((m: { id: string }) => m.id));
      res.key_valid = true;
      res.available = Object.fromEntries(t.models.map(m => [m, ids.has(m)]));
    } else { res.key_valid = [401, 403].includes(r.status) ? false : null; res.models_error = { http: r.status, error: redact(j.error?.message ?? j) }; }
  } catch (e) { res.models_error = redact(e); }
  res.ping = await Promise.all(t.models.map(async model => {
    const t0 = Date.now();
    try {
      const body = requestBody(t, model, [{ role: "system", content: "Reply with the single word ok." }, { role: "user", content: "ping" }], true);
      const r = await fetch(`${t.base}/chat/completions`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const j = await r.json();
      const ms = Date.now() - t0;
      return r.ok ? { model, ok: true, answered_by: j.model, reply: j.choices?.[0]?.message?.content, ms, tokens: j.usage?.total_tokens }
        : { model, ok: false, http: r.status, error: redact(j.error?.message ?? j), ms };
    } catch (e) { return { model, ok: false, error: redact(e), ms: Date.now() - t0 }; }
  }));
  return res;
}
