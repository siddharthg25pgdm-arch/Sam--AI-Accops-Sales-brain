/** ponytail: one runnable check for the website answer blocks (lib/blocks.ts + components/blocks/*).
 *  node lib/blocks.check.mjs   (from web/)  ->  throws if any of these breaks:
 *    1. every gallery fixture (and every state's props) parses with the contract
 *    2. over-long fields, unknown block types and a calculator without a (20+ char) disclaimer fail
 *    3. toOpenUI(): every fixture -> OpenUI Lang -> the OpenUI parser with zero errors, root = Answer, one node per block;
 *       an off-contract answer throws before it can render
 *    4. server render: every block renders, every verbatim text/label/value reaches the HTML, nothing unknown renders
 *    5. @openuidev/lang-core (library.tsx imports it) is a direct, exact dependency at the lockfile's version
 *    6. /embed/gallery (proposed and blocked fixtures) is notFound() when VERCEL_ENV=production, renders elsewhere
 *    7. emphasis (27 Oct): every fixture's text keeps the limits (lib/emphasis.ts); only `ai: true` is a valid flag
 *  3 and 4 need @openuidev/react-lang installed (npm ci); without it they are skipped and say so. */
import assert from "node:assert";
import { createRequire } from "node:module";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web }, jsx: { runtime: "automatic" } });
const B = await jiti.import("@/lib/blocks.ts");
const { emSplit, emProblems } = await jiti.import("@/lib/emphasis.ts");
const { fixtures } = createRequire(import.meta.url)("../components/blocks/fixtures.json");
const clone = o => JSON.parse(JSON.stringify(o));
const fails = (schema, v, why) => assert.equal(schema.safeParse(v).success, false, `should fail: ${why}`);

// 1. fixtures parse
let states = 0;
for (const f of fixtures) {
  const r = B.Answer.safeParse(f.answer);
  assert.ok(r.success, `${f.id}: ${r.error?.issues.map(i => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  for (const s of f.states ?? []) {
    states++;
    if (s.props) assert.ok(B.Block.safeParse({ ...f.answer.blocks[s.block], ...s.props }).success, `${f.id} state "${s.label}"`);
    assert.ok(f.answer.blocks[s.block], `${f.id} state "${s.label}" points at a block`);
  }
}
const types = new Set(fixtures.flatMap(f => f.answer.blocks.map(b => b.type)));
assert.deepEqual([...types].sort(), ["calculator", "compare_table", "cta", "doc_card", "picker", "stat", "steps", "text"], "the gallery covers every block type");

// 2. what must fail
const byId = id => clone(fixtures.find(f => f.id === id).answer);
const a1 = byId("lp-01"), table = a1.blocks[1];
fails(B.Block, { ...table, rows: [{ label: "NetScaler / ADC (gateway, load balancing)", cells: ["Built into the platform"] }] }, "row label 41 chars (the bank's lp-02 row)");
fails(B.Block, { ...table, columns: ["a", "b", "c", "d"] }, "4 columns");
fails(B.Block, { ...table, rows: Array(13).fill(table.rows[0]) }, "13 rows");
fails(B.Block, { ...table, source: undefined }, "a table without a source");
fails(B.Block, { type: "stat", value: "ISO 27001:2022", label: "Certified", source: table.source }, "stat value 14 chars (the bank's lp-17)");
fails(B.Block, { type: "stat", value: "50%", label: "lower TCO" }, "a stat without a source");
fails(B.Block, { type: "text", body: "x".repeat(601) }, "text 601 chars");
fails(B.Block, { type: "cta", label: "x".repeat(29), action: "talk_to_sales", url: "https://www.accops.com/" }, "cta label 29 chars");
fails(B.Block, { type: "doc_card", title: "t", kind: "PDF", summary: "s", url: "not a url", action: "read" }, "doc_card with a bad url");
fails(B.Block, { type: "chart", data: [1, 2] }, "unknown block type");
fails(B.Block, { type: "picker", prompt: "p", options: [{ label: "only one", qa_id: "lp-01" }] }, "picker with one option");
const calc = byId("calculator").blocks[0];
assert.ok(B.Block.safeParse(calc).success);
fails(B.Block, { ...calc, disclaimer: undefined }, "calculator without a disclaimer");
fails(B.Block, { ...calc, disclaimer: "Not a quote." }, "calculator with a disclaimer under 20 chars");
fails(B.Answer, { ...a1, blocks: Array(6).fill(a1.blocks[0]) }, "6 blocks");
fails(B.Answer, { ...a1, chips: [0, 1, 2, 3, 4].map(i => ({ id: `lp-0${i}`, label: "q" })) }, "5 chips (4 is the triage set: 3 routes + support)");
assert.ok(B.Answer.safeParse({ ...a1, chips: [...[0, 1, 2].map(i => ({ id: `lp-0${i}`, label: "q" })), { id: "support", label: "Support", url: "https://support.accops.com/" }] }).success, "4 chips, one an https link");
for (const url of ["http://support.accops.com/", "javascript:alert(1)", "https://x.example/\"><script>", "//support.accops.com"])
  fails(B.Chip, { id: "support", label: "Support", url }, `a link chip to ${url}`);
fails(B.Answer, { ...a1, lead: "x".repeat(121) }, "lead 121 chars");
fails(B.Block, { type: "text", body: "x", ai: false }, "ai is true or absent");
// 7. emphasis: every fixture text within the limits; the model fixture really uses it
for (const f of fixtures) for (const b of f.answer.blocks) if (b.type === "text") assert.deepEqual(emProblems(b.body), [], `${f.id}: emphasis limits`);
assert.ok(fixtures.some(f => f.answer.blocks.some(b => b.type === "text" && b.ai && emSplit(b.body).length >= 5)), "a model fixture with 2+ emphasised phrases");
// ... and the bank loader's Python twin flags exactly the same (it rejects; the server cleans model text instead)
let twin = "skipped (no python)";
{
  const { spawnSync } = await import("node:child_process");
  const cases = ["Accops helps **secure remote access** and more words in this answer here", "**a **b** c**", "**Yes.**", "stray * star", "plain text",
    `Use **one two three four five six seven** ${"pad ".repeat(20)}`, `**a** **b** **c** **d** **e** ${"pad ".repeat(20)}`, "** spaced ** markers"];
  const py = spawnSync("python", ["-c", "import json,sys; sys.path.insert(0, sys.argv[1]); import load_web_knowledge as L; " +
    "print(json.dumps([L.emphasis_errors(s) for s in json.loads(sys.stdin.read())]))", fileURLToPath(new URL("../../prototype", import.meta.url))],
    { input: JSON.stringify(cases), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (py.status === 0) { assert.deepEqual(JSON.parse(py.stdout), cases.map(emProblems), "emphasis rules: TS and the Python loader agree"); twin = `${cases.length} cases agree`; }
}

// 3 + 4. OpenUI round trip and server render
let openui = "skipped (@openuidev/react-lang not installed: npm ci)";
try { createRequire(import.meta.url).resolve("@openuidev/react-lang"); openui = ""; } catch { /* skipped */ }
if (!openui) {
  const L = await jiti.import("@/components/blocks/library.tsx");
  const { createParser } = await import("@openuidev/react-lang");
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const parser = createParser(L.library.toJSONSchema(), "Answer");
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  for (const f of fixtures) {
    const src = L.toOpenUI(f.answer);
    const r = parser.parse(src);
    assert.deepEqual(r.meta.errors, [], `${f.id}: parser errors`);
    assert.equal(r.root?.typeName, "Answer", `${f.id}: root`);
    assert.equal(r.root.props.blocks.length, f.answer.blocks.length, `${f.id}: every block survives`);
    const html = renderToStaticMarkup(React.createElement(L.AnswerBlocks, { answer: f.answer }));
    const must = [f.answer.lead, ...f.answer.chips.map(c => c.label), ...f.answer.blocks.flatMap(b =>
      [...(b.body ? emSplit(b.body) : []), b.title, b.summary, b.value, b.label, b.prompt, b.disclaimer, b.footnote, b.source?.label,
        ...(b.rows ?? []).flatMap(r => [r.label, ...(r.cells ?? [])]), ...(b.steps ?? []).map(s => s.title), ...(b.options ?? []).map(o => o.label)])];
    for (const t of must.filter(Boolean)) assert.ok(html.includes(esc(t)), `${f.id}: "${t.slice(0, 40)}" missing from the render`);
  }
  assert.throws(() => L.toOpenUI({ blocks: [{ type: "chart" }], chips: [] }), "an off-contract answer never renders");
  openui = `${fixtures.length} fixtures round-trip and render`;
}
// 5. lang-core is direct and exact (not left to hoisting), and the same version react-lang resolves
const pkg = createRequire(import.meta.url)("../package.json"), lock = createRequire(import.meta.url)("../package-lock.json");
const lc = lock.packages["node_modules/@openuidev/lang-core"]?.version;
assert.ok(lc && pkg.dependencies["@openuidev/lang-core"] === lc && lock.packages[""].dependencies["@openuidev/lang-core"] === lc,
  `@openuidev/lang-core must be a direct exact dependency (${lc}), got ${pkg.dependencies["@openuidev/lang-core"]}`);

// 6. the gallery is never served in production (fonts, CSS and the client gallery stubbed: only the gate runs)
{
  const { mkdtempSync, writeFileSync } = await import("node:fs"), path = await import("node:path"), { tmpdir } = await import("node:os");
  const stub = path.join(mkdtempSync(path.join(tmpdir(), "gallery-")), "stub.mjs");
  writeFileSync(stub, "export const Barlow = () => ({ variable: 'f' }); export default () => null;");
  const gj = createJiti(import.meta.url, { alias: { "next/font/google": stub, "@/components/blocks/blocks.css": stub, "./gallery.css": stub, "./Gallery": stub, "@": web }, jsx: { runtime: "automatic" } });
  const Page = (await gj.import("@/app/embed/gallery/page.tsx")).default, was = process.env.VERCEL_ENV;
  for (const env of [undefined, "development", "preview"]) {
    if (env) process.env.VERCEL_ENV = env; else delete process.env.VERCEL_ENV;
    assert.ok(Page(), `gallery renders with VERCEL_ENV=${env}`);
  }
  process.env.VERCEL_ENV = "production";
  assert.throws(() => Page(), e => String(e?.digest).includes("404"), "gallery is notFound() in production");
  if (was === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = was;
}
console.log(`blocks: ${fixtures.length} fixtures + ${states} states parse; 22 must-fail cases fail; emphasis within limits (Python twin: ${twin}); lang-core direct; gallery 404 in production; OpenUI: ${openui}`);
