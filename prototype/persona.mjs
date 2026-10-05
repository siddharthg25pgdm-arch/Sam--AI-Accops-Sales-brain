/** Salesperson persona test: ask production SAM what reps ask, save every full answer for grading.
 *
 *    node prototype/persona.mjs                 # all 50, one every 20 s, to corpus/persona-<date>.json
 *    node prototype/persona.mjs --only new      # just the 15 unseen questions
 *    node prototype/persona.mjs --pace 30000
 *
 *  "core" = the 35 questions of the 26-28 Sep runs, verbatim from sam_events 1419-1496, so grades
 *  compare run to run. "new" = 15 questions SAM was never tuned against (written 6 Oct 2026); a
 *  system scored only on questions it was fixed for overfits, so these are the honest number.
 *  A turn with `follow: true` carries the previous turns of its chain as history, as the web chat does.
 *  Every call sends x-sam-test: 1, so it is excluded from usage metrics. Token: the dwight-test
 *  entry of SAM_API_TOKENS in web/.env.deploy.local (never printed).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const base = arg("--base", "https://sam-accops.vercel.app");
const pace = Number(arg("--pace", 20000));
const only = arg("--only", "");

const QUESTIONS = [
  // ---- core: verbatim from the 28 Sep run ----
  ["core", 1, "AE", "pvt bank in mumbai moving off citrix, need a bfsi case study i can send them"],
  ["core", 2, "AE", "anything newer?", true],
  ["core", 3, "AE", "shorter one? something 1-2 pages", true],
  ["core", 4, "AE", "citrix battlecard for my own prep before the call tmrw"],
  ["core", 5, "AE", "CISO at the bank asked how we help with RBI cyber security framework / RBI guidelines on remote access. what can i send him"],
  ["core", 6, "AE", "whats the pricing for 2000 users hyworks, customer comparing with citrix quote"],
  ["core", 7, "SDR", "one pager on HyID i can email"],
  ["core", 8, "SDR", "pharma customer proof"],
  ["core", 9, "SDR", "manufacturing plant VDI case study"],
  ["core", 10, "SDR", "whats our ZTNA pitch for a GCC"],
  ["core", 11, "SDR", "customer logo pack"],
  ["core", 12, "SDR", "product video hysecure"],
  ["core", 13, "SE", "need ISO 27001 certificate for an RFP"],
  ["core", 14, "SE", "do we have SOC 2 type 2 report"],
  ["core", 15, "SE", "remote browser isolation brochure"],
  ["core", 16, "SE", "customer on vmware horizon wants to move after broadcom price hike, omnissa migration pitch?"],
  ["core", 17, "REG", "bahasa indonesia brochure for daas"],
  ["core", 18, "SE", "omnissa migration deck for a horizon customer"],
  ["core", 19, "SE", "customer asking about data residency - is our DaaS hosted in india? need a doc i can put in the RFP response"],
  ["core", 20, "SE", "hysecure architecture / deployment guide for presales"],
  ["core", 21, "SE", "does hyworks support nutanix AHV and proxmox? need integration doc"],
  ["core", 22, "SE", "hyworks sizing for 500 concurrent users, server specs?"],
  ["core", 23, "SE", "hysecure datasheet specs - max concurrent users per appliance"],
  ["core", 24, "REG", "arabic brochure for a saudi bank prospect"],
  ["core", 25, "REG", "any malaysia or indonesia customer reference i can share with a partner?"],
  ["core", 26, "REG", "australian gov / APRA CPS 234 angle for hysecure - anything?"],
  ["core", 27, "REG", "middle east event deck, gitex dubai"],
  ["core", 28, "REG", "fortinet vpn replacement pitch"],
  ["core", 29, "SE", "aws workspaces vs hyworks comparison"],
  ["core", 30, "AE", "bhai urgent hyworks brocher bhejo customer ko abhi"],
  ["core", 31, "AE", "Hospital chain in Kerala, ~800 users, want VDI for their HIS + PACS access from outside, evaluating Citrix and Azure Virtual Desktop. Need something I can send the CIO today plus something for my own prep against AVD"],
  ["core", 32, "SDR", "pharma case study I can send a customer"],
  ["core", 33, "SDR", "what about hospitals?", true],
  ["core", 34, "SE", "hysecure demo video"],
  ["core", 35, "SE", "cisco anyconnect replacement"],
  // ---- new: never tuned against ----
  ["new", 36, "AE", "insurance company wants MFA for their agents, any customer proof I can share?"],
  ["new", 37, "AE", "NBFC asking about RBI compliance for remote access, what do i send"],
  ["new", 38, "SDR", "BPO with 3000 work from home agents, which deck should i open with"],
  ["new", 39, "AE", "defence PSU evaluating VDI, any government or defence case study"],
  ["new", 40, "SE", "university wants virtual labs for engineering students, case study?"],
  ["new", 41, "SE", "how do we position against zscaler private access"],
  ["new", 42, "SE", "okta vs hyid - anything for my prep"],
  ["new", 43, "AE", "first meeting with a CIO tomorrow, latest corporate deck please"],
  ["new", 44, "AE", "is that one ok to send to the customer after the meeting?", true],
  ["new", 45, "SDR", "telecom operator looking at zero trust, any reference"],
  ["new", 46, "AE", "retail chain with 200 stores wants thin clients, anything"],
  ["new", 47, "SE", "customer wants on-prem MFA with fingerprint login, datasheet i can send"],
  ["new", 48, "SE", "microsoft AVD vs accops DaaS, need talking points"],
  ["new", 49, "AE", "logistics company needs DaaS for warehouse staff, any similar customer"],
  ["new", 50, "PARTNER", "new SI partner joining next week, what training deck do we give them"],
].map(([set, n, persona, question, follow]) => ({ set, n, persona, question, follow: !!follow }));

function token() {
  const env = readFileSync(join(ROOT, "web", ".env.deploy.local"), "utf8");
  const line = env.split(/\r?\n/).find(l => l.startsWith("SAM_API_TOKENS="));
  const pairs = (line ?? "").slice("SAM_API_TOKENS=".length).replace(/^"|"$/g, "").split(",");
  const hit = pairs.find(p => p.startsWith("dwight-test:")) ?? pairs.find(p => p.startsWith("dwight-siddharth:"));
  if (!hit) throw new Error("no dwight-test / dwight-siddharth token in web/.env.deploy.local");
  return hit.slice(hit.indexOf(":") + 1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tok = token();
const todo = QUESTIONS.filter(q => !only || q.set === only);
const out = [];
let history = [];
for (const [i, q] of todo.entries()) {
  if (!q.follow) history = [];
  const t0 = Date.now();
  let body;
  try {
    const res = await fetch(`${base}/api/v1/ask`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", "x-sam-test": "1" },
      body: JSON.stringify({ question: q.question, history }),
    });
    body = { status: res.status, ...(await res.json().catch(() => ({}))) };
  } catch (e) {
    body = { status: 0, error: String(e) };
  }
  const answer = body.answer ?? body.text ?? "";
  out.push({ ...q, ms: Date.now() - t0, history: history.length, response: body });
  history = [...history, { role: "user", content: q.question }, { role: "assistant", content: String(answer) }].slice(-6);
  console.log(`#${q.n} [${q.set}] ${body.status} ${Date.now() - t0}ms ${body.model ?? ""} ${q.question.slice(0, 60)}`);
  if (i < todo.length - 1) await sleep(pace);
}
mkdirSync(join(ROOT, "corpus"), { recursive: true });
const file = join(ROOT, "corpus", `persona-${new Date().toISOString().slice(0, 10)}${only ? "-" + only : ""}.json`);
writeFileSync(file, JSON.stringify({ base, ran_at: new Date().toISOString(), results: out }, null, 2));
console.log(`saved ${out.length} answers -> ${file}`);
