/** ponytail: one runnable check for the website answer blocks (lib/blocks.ts + components/blocks/*).
 *  node lib/blocks.check.mjs   (from web/)  ->  throws if any of these breaks:
 *    1. every gallery fixture (and every state's props) parses with the contract
 *    2. over-long fields, unknown block types and a calculator without a (20+ char) disclaimer fail
 *    3. toOpenUI(): every fixture -> OpenUI Lang -> the OpenUI parser with zero errors, root = Answer, one node per block;
 *       an off-contract answer throws before it can render
 *    4. server render: every block renders, every verbatim text/label/value reaches the HTML, nothing unknown renders
 *  3 and 4 need @openuidev/react-lang installed (npm ci); without it they are skipped and say so. */
import assert from "node:assert";
import { createRequire } from "node:module";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web }, jsx: { runtime: "automatic" } });
const B = await jiti.import("@/lib/blocks.ts");
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
fails(B.Answer, { ...a1, chips: [...a1.chips, a1.chips[0]] }, "4 chips");
fails(B.Answer, { ...a1, lead: "x".repeat(121) }, "lead 121 chars");

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
      [b.body, b.title, b.summary, b.value, b.label, b.prompt, b.disclaimer, b.footnote, b.source?.label,
        ...(b.rows ?? []).flatMap(r => [r.label, ...(r.cells ?? [])]), ...(b.steps ?? []).map(s => s.title), ...(b.options ?? []).map(o => o.label)])];
    for (const t of must.filter(Boolean)) assert.ok(html.includes(esc(t)), `${f.id}: "${t.slice(0, 40)}" missing from the render`);
  }
  assert.throws(() => L.toOpenUI({ blocks: [{ type: "chart" }], chips: [] }), "an off-contract answer never renders");
  openui = `${fixtures.length} fixtures round-trip and render`;
}
console.log(`blocks: ${fixtures.length} fixtures + ${states} states parse; 17 must-fail cases fail; OpenUI: ${openui}`);
