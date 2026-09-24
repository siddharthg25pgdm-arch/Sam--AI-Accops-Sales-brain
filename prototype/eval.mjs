/** Score SAM against docs/eval-set.md. Design phase 1 exit criterion is hit@3 >= 85%.
 *
 *  Reads the questions straight out of the markdown table so there is one copy, not two that drift.
 *  Exits non-zero below the threshold, so this can gate a deploy once the invented questions have
 *  been replaced with real ones.
 *
 *    SAM_API_TOKEN=... node prototype/eval.mjs                      # production, one question every 20 s
 *    SAM_API_TOKEN=... node prototype/eval.mjs --pace 30000         # slower, if Groq still rate-limits
 *    SAM_API_TOKEN=... node prototype/eval.mjs --base http://localhost:3000
 *
 *  Paced because Groq's free tier allows ~8,000 tokens a minute: unpaced, most questions 429 and are
 *  answered by retrieval, so the "model" score was really retrieval's. Retrieval-answered questions
 *  are now scored separately, and the exit code gates on the model's own rate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const base = arg("--base", "https://sam-accops.vercel.app");
const local = /localhost|127\.0\.0\.1/.test(base);
const pace = Number(arg("--pace", local ? 0 : 20000));
const token = process.env.SAM_API_TOKEN;
const THRESHOLD = 85;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!token) {
  console.error("Set SAM_API_TOKEN (a value from SAM_API_TOKENS, the part after the label colon).");
  process.exit(2);
}

/** Parse the markdown table. Rows look like: | 1 | question | type | expect | source | */
function questions() {
  const md = readFileSync(join(HERE, "..", "docs", "eval-set.md"), "utf8");
  const out = [];
  // Split on \r?\n: git's autocrlf writes CRLF on Windows, and a trailing \r breaks the row regex
  // silently - it reports "0 questions" rather than failing, which reads like an empty file.
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\d+)\s*\|(.+)$/);
    if (!m) continue;
    const cells = m[2].split("|").map(c => c.trim());
    const [q, type, expect, source] = cells;
    if (!q || !type) continue;
    out.push({ n: Number(m[1]), q, type, expect, modelled: /modelled/i.test(source ?? "") });
  }
  return out;
}

/** POST one question. Retries a 429/503 from SAM itself (up to 3 times, honouring Retry-After), and
 *  retries ONCE, a minute later, a question that fell back to retrieval because the model was rate
 *  limited - so a busy minute does not quietly turn a model question into a retrieval one. */
async function ask(q) {
  for (let attempt = 0, fellBack = false; ; attempt++) {
    const r = await fetch(`${base}/api/v1/ask`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-sam-test": "1" },
      body: JSON.stringify({ question: q }),
    });
    if ((r.status === 429 || r.status === 503) && attempt < 3) { await sleep(Number(r.headers.get("retry-after")) * 1000 || 30000); continue; }
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    const res = await r.json();
    const limited = res.runtime === "local" && (res.trace ?? []).some(t => /fell back/.test(t.step) && /429|rate limit/i.test(t.detail));
    if (limited && !fellBack && !local) { fellBack = true; console.log(`        (model rate-limited on #${q.slice(0, 30)}..., retrying in 60 s)`); await sleep(60000); continue; }
    return res;
  }
}

// ---- Grounding: does the answer name a document that is not among the returned assets?
// Deliberately an independent, cruder copy of the server's guard (web/lib/agent.ts namedTitles), so
// the eval can catch the guard itself missing something rather than agreeing with it by construction.
const DOC = /\b(deck|battle ?card|white ?paper|brochure|data ?sheet|case stud(y|ies)|overview|guide|report|certificat|presentation|comparison|e-?book|brief|playbook)/i;
const toks = s => s.toLowerCase().replace(/white paper/g, "whitepaper").replace(/data sheet/g, "datasheet").split(/[^a-z0-9]+/)
  .map(t => t.replace(/s$/, "")).filter(t => t.length > 1 && !["the", "a", "an", "of", "for", "and", "accops", "to", "in"].includes(t));
function ungrounded(answer, assets) {
  const spans = [];
  for (const line of (answer ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+\*\*(.+?)\*\*/);
    if (m) spans.push(m[1]);
  }
  for (const m of (answer ?? "").matchAll(/\*\*(.+?)\*\*|["“]([^"”\n]{4,120})["”]/g)) {
    const s = m[1] ?? m[2];
    if (DOC.test(s) && !/\b(no|not|any)\s+(\S+\s+){0,2}(\*\*|["“])?$/i.test(answer.slice(Math.max(0, m.index - 30), m.index))) spans.push(s);
  }
  const known = assets.map(a => new Set(toks(`${a.title ?? ""} ${a.asset_type ?? ""} ${(a.path ?? "").split("/").pop()}`)));
  return [...new Set(spans)].filter(s => {
    const c = toks(s);
    return c.length && !known.some(k => c.filter(t => k.has(t)).length / c.length >= 0.7);
  });
}

/** What answered, from the response and trace: "model <name>" or "retrieval". */
function who(res) {
  const t = res.trace ?? [];
  const tokens = t.map(s => s.detail?.match(/(\d+) tokens/)?.[1]).filter(Boolean).map(Number).reduce((a, b) => a + b, 0);
  const considered = t.filter(s => s.step === "tool result").map(s => s.detail?.match(/of (\d+) assets/)?.[1]).filter(Boolean).pop();
  return { model: res.runtime === "local" ? null : res.model ?? res.runtime, tokens, considered: considered ? Number(considered) : null };
}

/** A hit is "would a rep have sent one of these three", scored per question type. */
function judge(qn, res) {
  const assets = res.assets ?? [];
  const titles = assets.map(a => `${a.title ?? ""} ${a.path ?? ""}`).join(" | ").toLowerCase();

  if (qn.type === "gap") {
    // Admitting a hole is the correct answer. Returning assets anyway is the failure - a tool that
    // answers everything confidently is worse than one that says no.
    return { hit: res.gap === true || assets.length === 0, why: res.gap ? "declared a gap" : `returned ${assets.length}` };
  }
  if (qn.type === "external") {
    if (assets.length === 0) return { hit: res.gap === true, why: "nothing returned" };
    const sendable = assets.filter(a => a.link && !/sharepoint\.com/i.test(a.link));
    return { hit: sendable.length > 0, why: `${sendable.length}/${assets.length} have a public link` };
  }
  if (!qn.expect) return { hit: null, why: "no expect set - unscored" };
  return { hit: titles.includes(qn.expect.toLowerCase()), why: assets.length ? assets[0].title?.slice(0, 40) : "nothing returned" };
}

const qs = questions();
console.log(`${qs.length} questions against ${base}, one every ${pace / 1000} s\n`);
// Scored separately by what answered: a retrieval fallback is not the model's result.
const tally = { model: { hits: 0, scored: 0 }, retrieval: { hits: 0, scored: 0 } };
let unscored = 0, modelled = 0, errors = 0, tokenSum = 0, tokenN = 0;
const invented = [];

for (const [i, qn] of qs.entries()) {
  if (i && pace) await sleep(pace);
  const n = qn.n.toString().padStart(2), q = qn.q.slice(0, 48).padEnd(50);
  let res;
  try { res = await ask(qn.q); }
  catch (e) { errors++; console.log(`  ERR   ${n}  ${q} ${e.message}`); continue; }
  const { hit, why } = judge(qn, res);
  const w = who(res);
  if (w.tokens) { tokenSum += w.tokens; tokenN++; }
  const bad = ungrounded(res.answer, res.assets ?? []);
  if (bad.length) invented.push({ n: qn.n, q: qn.q, bad });
  const tag = `${(w.model ?? "retrieval").replace(/^openai\//, "").padEnd(12)} ${w.tokens ? `${w.tokens}t`.padStart(6) : "".padStart(6)} ${w.considered ? `/${w.considered}` : ""}`;
  if (qn.modelled) modelled++;
  const flag = bad.length ? `  UNGROUNDED: ${bad.join("; ")}` : "";
  if (hit === null) { unscored++; console.log(`  ----  ${n}  ${q} ${tag.padEnd(26)} ${why}${flag}`); continue; }
  const bucket = tally[w.model ? "model" : "retrieval"];
  bucket.scored++; if (hit) bucket.hits++;
  console.log(`  ${hit ? "HIT " : "MISS"}  ${n}  ${q} ${tag.padEnd(26)} ${why}${flag}`);
}

const pct = b => (b.scored ? Math.round((b.hits / b.scored) * 100) : 0);
const all = { hits: tally.model.hits + tally.retrieval.hits, scored: tally.model.scored + tally.retrieval.scored };
console.log(`\nhit@3, model-answered:     ${tally.model.hits}/${tally.model.scored} = ${pct(tally.model)}%   (threshold ${THRESHOLD}%)`);
console.log(`hit@3, retrieval fallback: ${tally.retrieval.hits}/${tally.retrieval.scored} = ${pct(tally.retrieval)}%${tally.retrieval.scored ? "   <- the model did not answer these; slow down with --pace" : ""}`);
console.log(`hit@3, all:                ${all.hits}/${all.scored} = ${pct(all)}%`);
if (tokenN) console.log(`model tokens per question: ${Math.round(tokenSum / tokenN)} average over ${tokenN}`);
console.log(invented.length
  ? `\nGROUNDING: ${invented.length} answer(s) name a document not among the returned assets:\n${invented.map(x => `  #${x.n} ${x.q}: ${x.bad.join("; ")}`).join("\n")}`
  : "\nGROUNDING: no answer names a document outside its returned assets.");
if (errors) console.log(`${errors} request(s) failed`);
if (unscored) console.log(`${unscored} unscored - fill in the expect column`);
if (modelled) console.log(`${modelled} of ${qs.length} are modelled, not real asks. Replace them from sam_events once reps have used SAM for a few weeks.`);
// Gate on the model's own rate when the model answered anything; retrieval-only runs gate on all.
const gate = tally.model.scored ? pct(tally.model) : pct(all);
// exitCode, not exit(): exiting with fetch keep-alive sockets still closing trips a libuv assertion on Windows.
process.exitCode = gate >= THRESHOLD && !invented.length ? 0 : 1;
