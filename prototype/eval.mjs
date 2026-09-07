/** Score SAM against docs/eval-set.md. Design phase 1 exit criterion is hit@3 >= 85%.
 *
 *  Reads the questions straight out of the markdown table so there is one copy, not two that drift.
 *  Exits non-zero below the threshold, so this can gate a deploy once the invented questions have
 *  been replaced with real ones.
 *
 *    SAM_API_TOKEN=... node prototype/eval.mjs
 *    SAM_API_TOKEN=... node prototype/eval.mjs --base http://localhost:3000
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://sam-accops.vercel.app";
const token = process.env.SAM_API_TOKEN;
const THRESHOLD = 85;

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

async function ask(q) {
  const r = await fetch(`${base}/api/v1/ask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question: q }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
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
console.log(`${qs.length} questions against ${base}\n`);
let hits = 0, scored = 0, unscored = 0, modelled = 0;

for (const qn of qs) {
  let res;
  try { res = await ask(qn.q); }
  catch (e) { console.log(`  ERR  ${qn.n.toString().padStart(2)}  ${qn.q.slice(0, 52)}  ${e.message}`); continue; }
  const { hit, why } = judge(qn, res);
  if (qn.modelled) modelled++;
  if (hit === null) { unscored++; console.log(`  ----  ${qn.n.toString().padStart(2)}  ${qn.q.slice(0, 52).padEnd(54)} ${why}`); continue; }
  scored++; if (hit) hits++;
  console.log(`  ${hit ? "HIT " : "MISS"}  ${qn.n.toString().padStart(2)}  ${qn.q.slice(0, 52).padEnd(54)} ${why}`);
}

const rate = scored ? Math.round((hits / scored) * 100) : 0;
console.log(`\nhit@3: ${hits}/${scored} = ${rate}%   (threshold ${THRESHOLD}%)`);
if (unscored) console.log(`${unscored} unscored - fill in the expect column`);
if (modelled) console.log(`${modelled} of ${qs.length} are modelled, not real asks. Replace them from sam_events once reps have used SAM for a few weeks.`);
process.exit(rate >= THRESHOLD ? 0 : 1);
