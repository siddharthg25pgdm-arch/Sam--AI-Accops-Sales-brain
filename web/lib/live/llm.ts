/** Where SAM Live's models run, in order. Primary: its own OpenAI key, LIVE_OPENAI_API_KEY (base
 *  LIVE_OPENAI_BASE_URL, default api.openai.com) - deliberately not SAM chat's OPENAI_API_KEY, which would
 *  move SAM's answers to OpenAI too. Fallback: SAM's OpenAI-compatible tier (production: Groq, from
 *  lib/agent-openai.ts tiers()). Without the OpenAI key everything runs on Groq alone.
 *  Models benchmarked on a synthetic Accops call, 14 Oct 2026: gpt-transcribe was the only STT to get
 *  Omnissa, HySecure, HyWorks and "1,200" right; gpt-5.4-mini extracted the most fields in 3.5 s;
 *  gpt-5.5 wrote the best follow-up email. */
import { defaultEffort, tiers } from "../agent-openai";
import { cleanKey, redact } from "../redact";

export type Provider = { name: string; base: string; key: string; openai: boolean };
export type Leg = { p: Provider; model: string; cap: number };
export type Job = "stt" | "insight" | "summary";

const isOpenAIHost = (base: string) => /^https:\/\/([a-z0-9-]+\.)*api\.openai\.com(\/|$)/i.test(base);
/** "groq" for api.groq.com, "openai" for api.openai.com: what a stored model label says. */
const hostName = (base: string) => { try { return new URL(base).hostname.split(".").slice(-2, -1)[0] || "compat"; } catch { return "compat"; } };

function provider(base: string, key: string): Provider {
  const b = base.replace(/\/$/, "");
  return { name: hostName(b), base: b, key, openai: isOpenAIHost(b) };
}
export function openaiProvider(): Provider | null {
  const key = cleanKey(process.env.LIVE_OPENAI_API_KEY, "LIVE_OPENAI_API_KEY").key;
  return key ? provider(process.env.LIVE_OPENAI_BASE_URL || "https://api.openai.com/v1", key) : null;
}
export function compatProvider(): Provider | null {
  const t = tiers().find(t => t.provider === "openai-compatible");
  return t ? provider(t.base, t.key) : null;
}

/** Each job's models in the order tried; `cap` is the most one attempt may take. */
export function legs(job: Job): Leg[] {
  const o = openaiProvider(), c = compatProvider(), e = process.env;
  const plan: [Provider | null, string, number][] = {
    stt: [[o, e.LIVE_STT_MODEL || "gpt-transcribe", 12_000], [c, e.LIVE_STT_FALLBACK_MODEL || "whisper-large-v3-turbo", 15_000]],
    insight: [[o, e.LIVE_INSIGHT_MODEL || "gpt-5.4-mini", 6_000], [c, "openai/gpt-oss-20b", 8_000]],
    // Groq's 120b has a daily token cap, hence 20b behind it.
    summary: [[o, e.LIVE_SUMMARY_MODEL || "gpt-5.5", 22_000], [c, "openai/gpt-oss-120b", 16_000], [c, "openai/gpt-oss-20b", 20_000]],
  }[job] as [Provider | null, string, number][];
  return plan.filter((x): x is [Provider, string, number] => x[0] !== null).map(([p, model, cap]) => ({ p, model, cap }));
}
export const label = (l: Leg) => `${l.p.name}:${l.model}`;

export class NoModel extends Error {
  constructor(message: string, readonly unconfigured: boolean) { super(message); }
}

const MIN_LEG = 4000;
/** Try `ls` in order until one gives a usable answer (run() returns null for an unusable one), all within
 *  `deadline`. Each attempt gets at most its cap and leaves every later one MIN_LEG ms. Returns the
 *  answer and the label of the model that gave it; logs the failures it recovered from; throws NoModel
 *  with every failure when none answered. */
export async function firstAnswer<T>(job: Job, ls: Leg[], deadline: number, run: (l: Leg, timeoutMs: number) => Promise<T | null>): Promise<{ value: T; model: string }> {
  if (!ls.length) throw new NoModel(`live ${job}: no model configured (LIVE_OPENAI_API_KEY or an OpenAI-compatible tier)`, true);
  const failures: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const timeoutMs = Math.min(ls[i].cap, deadline - Date.now() - MIN_LEG * (ls.length - 1 - i));
    if (timeoutMs < 1000) { failures.push(`${label(ls[i])}: no time left`); continue; }
    try {
      const value = await run(ls[i], timeoutMs);
      if (value !== null) {
        if (failures.length) console.warn(`live ${job}: answered by ${label(ls[i])} after ${failures.join(" | ")}`);
        return { value, model: label(ls[i]) };
      }
      failures.push(`${label(ls[i])}: unusable reply`);
    } catch (e) {
      failures.push(`${label(ls[i])}: ${(e as Error)?.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : redact(e)}`);
    }
  }
  throw new NoModel(`live ${job}: ${failures.join(" | ")}`, false);
}

export type Msg = { role: "system" | "user"; content: string };

/** One JSON-mode chat completion; returns the reply text. OpenAI and Groq differ: OpenAI takes
 *  max_completion_tokens, reasoning_effort by family ("none" for gpt-5.4/5.5) and store:false; gpt-oss on
 *  Groq spends max_tokens on reasoning first, so it gets "low" and more room. */
export async function chatJSON(l: Leg, messages: Msg[], o: { maxTokens: number; timeoutMs: number }): Promise<string> {
  let body: Record<string, unknown>;
  if (l.p.openai) {
    const effort = defaultEffort(l.model), thinking = effort !== null && effort !== "none";
    body = { model: l.model, messages, response_format: { type: "json_object" }, max_completion_tokens: thinking ? o.maxTokens + 2000 : o.maxTokens,
      ...(thinking ? {} : { temperature: 0.2 }), ...(effort !== null ? { reasoning_effort: effort } : {}), store: false };
  } else {
    body = { model: l.model, messages, response_format: { type: "json_object" }, temperature: 0.2, max_tokens: o.maxTokens + 1500,
      ...(/gpt-oss/.test(l.model) ? { reasoning_effort: "low" } : {}) };
  }
  const r = await fetch(`${l.p.base}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${l.p.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(1000, o.timeoutMs)),
  });
  if (!r.ok) throw new Error(redact(`${r.status}: ${(await r.text()).slice(0, 200)}`));
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content ?? "");
}

/** A model reply -> an object, repairing what models get wrong: code fences, prose around the JSON,
 *  trailing commas, and a reply cut off by the token limit (open strings, arrays and objects are closed). */
export function parseJSON(raw: string): Record<string, unknown> | null {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  const body = s.slice(start), end = body.lastIndexOf("}");
  const noTrailing = (x: string) => x.replace(/,\s*([}\]])/g, "$1");
  for (const attempt of [body, noTrailing(body.slice(0, end + 1)), noTrailing(closeOpen(body))]) {
    try {
      const v = JSON.parse(attempt);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* next attempt */ }
  }
  return null;
}

/** Close a truncated JSON text: finish an open string, drop a dangling key or comma, close brackets. */
function closeOpen(s: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  const out = (inStr ? `${s}"` : s).replace(/,\s*"[^"]*"\s*:?\s*$/, "").replace(/[,:]\s*$/, "");
  return out + stack.reverse().join("");
}

/** Strings from a model array: trimmed, de-duplicated, capped. */
export function strings(v: unknown, max: number, len = 160): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = typeof x === "string" ? x.trim().replace(/\s+/g, " ").slice(0, len) : "";
    if (s && !out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, max);
}
