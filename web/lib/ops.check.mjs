/** ponytail: one runnable check for the job run log and token accounting (lib/ops.ts).
 *  node lib/ops.check.mjs  (from web/)  ->  throws if the next-run time, the stale rule (30 h, and never
 *  on day one of the log), the digest lines, the trace token parse or the quota/cost maths break. */
import assert from "node:assert";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { nextRun, jobStates, jobHealth, traceTokens, tokenUsage, STALE_H } = await jiti.import("./ops.ts");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// nextRun: HH:MM India time, the next one after now.
ok(nextRun("08:30", "2026-09-30T02:00:00Z") === "2026-09-30T03:00:00.000Z", "08:30 IST today, still ahead");
ok(nextRun("08:30", "2026-09-30T03:00:00Z") === "2026-10-01T03:00:00.000Z", "exactly at the time: tomorrow");
ok(nextRun("02:00", "2026-09-30T19:00:00Z") === "2026-09-30T20:30:00.000Z", "after IST midnight rolls over");

const now = "2026-09-30T06:00:00Z";
const run = (job, h, status = "ok", summary = "") => ({ job, started_at: new Date(Date.parse(now) - h * 3_600_000).toISOString(), finished_at: null, status, summary });
{
  const s = jobStates([], now, null);
  ok(s.every(j => !j.stale && j.state === "off"), "day one: no runs and no log yet is not an alarm");
  ok(jobHealth(s).length === 0, "and the digest says nothing");
}
{
  const runs = [run("snapshot", 4), run("carding_prep", 23), run("carding", 40, "ok", "nothing to card"), run("digest", 21), run("cron", 22, "failed", "boom")];
  const s = jobStates(runs, now, runs[2].started_at), by = Object.fromEntries(s.map(j => [j.job, j]));
  ok(by.snapshot.state === "ok" && !by.snapshot.stale, "a 4-hour-old run is fine");
  ok(by.carding.stale && by.carding.state === "bad", `a daily job silent for more than ${STALE_H} h is stale`);
  ok(by.cron.state === "bad" && !by.cron.stale, "a failed last run is bad, not stale");
  ok(by.rollup.stale && by.rollup.last === null, "a job never seen once the log is older than 30 h is stale");
  const h = jobHealth(s).map(x => x.title);
  ok(h.some(t => /Nightly carding: result has not run for 40 hours/.test(t)) && h.some(t => /Registry health cron: last run failed/.test(t))
    && h.some(t => /Metrics rollup has not run since run logging began/.test(t)) && !h.some(t => /snapshot|prep/i.test(t)), `digest lines: ${h.join(" | ")}`);
}

// traceTokens: the model step of both runtimes; nothing when retrieval answered.
ok(traceTokens([{ step: "model", detail: "openai/gpt-oss-120b (openai-compatible) · 3.1s · 2140 tokens" }]) === 2140, "OpenAI-compatible trace");
ok(traceTokens([{ step: "model", detail: "claude-sonnet-5 · 4.0s · 1800 in / 300 out" }]) === 2100, "Claude trace");
ok(traceTokens([{ step: "model", detail: "none, retrieval only · 12ms" }]) === null && traceTokens(undefined) === null, "retrieval only has no tokens");
ok(traceTokens([{ step: "tool result", detail: "5 of 400 assets" }, { step: "model", detail: "m · 1s · 10 tokens" }]) === 10, "only the model step counts");

// tokenUsage: IST days, share of Groq's daily quota, OpenAI spend estimate.
const u = tokenUsage([
  { created_at: "2026-09-29T20:00:00Z", model: "openai/gpt-oss-120b", tokens: 100_000 },   // 30 Sep 01:30 IST
  { created_at: "2026-09-30T05:00:00Z", model: "openai/gpt-oss-120b", tokens: 50_000 },
  { created_at: "2026-09-30T05:00:00Z", model: "gpt-5-mini", tokens: 1_000_000 },
  { created_at: "2026-09-30T05:00:00Z", model: "unknown-model", tokens: 5 },
  { created_at: "2026-09-30T05:00:00Z", model: null, tokens: null },
]);
const g = u.find(x => x.model === "openai/gpt-oss-120b"), o = u.find(x => x.model === "gpt-5-mini");
ok(g.day === "2026-09-30" && g.tokens === 150_000 && g.answers === 2 && g.pctOfQuota === 75 && g.usd === null, "Groq: an IST day, 75% of 200k, no price");
ok(o.provider === "OpenAI" && o.quota === null && Math.abs(o.usd - 0.425) <= 0.01, `OpenAI: 1M tokens at 90% input is about USD 0.42 (${o.usd})`);
ok(u.find(x => x.model === "unknown-model").usd === null && u.length === 3, "an unknown model shows tokens only; rows with no model are skipped");

console.log(`ops.check: ${n} assertions passed`);
