// Stream D's real-browser pass, with no Next server (laptop RAM) and no deployment (production is inert, previews are
// behind protection): the widget is bundled with esbuild and served by a tiny mock of SAM (/embed, /embed.js,
// /api/web/config|ask|event answering from components/blocks/fixtures.json); the Citrix LP is served from its folder
// on a SECOND origin, so the loader <-> iframe bridge is genuinely cross-origin. Chrome via playwright-core.
// usage (from web/): node scripts/web-widget-shots.mjs [LP dir] [out dir]
//   defaults: ~/Downloads/accops-citrix-lp, ../docs/plans/shots. Needs esbuild (see build-embed.mjs) and Chrome.
// Writes web-widget-{1280,375}-*.png + web-widget-shots.json (the acceptance results and measured sizes) and exits 1
// if any acceptance item fails. What only a live preview can show (GA4 DebugView, BotID, the real /api/web round
// trip, frame-ancestors from Vercel's edge) is listed as "to verify once enabled" in the stage-1 report, not faked here.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { findEsbuild } from "./build-embed.mjs";

const web = fileURLToPath(new URL("..", import.meta.url));
const LPDIR = process.argv[2] ?? path.join(homedir(), "Downloads/accops-citrix-lp");
const OUT = process.argv[3] ?? path.join(web, "../docs/plans/shots");
mkdirSync(OUT, { recursive: true });
const { fixtures } = JSON.parse(readFileSync(path.join(web, "components/blocks/fixtures.json"), "utf8"));
const FX = Object.fromEntries(fixtures.map(f => [f.id, f.answer]));

// ---------- bundle the widget (the same client code /embed ships, minus the Next runtime) ----------
const esbuild = findEsbuild();
const tmp = mkdtempSync(path.join(tmpdir(), "web-widget-shots-"));
const at = {
  name: "at", setup(b) {
    b.onResolve({ filter: /^@\// }, a => b.resolve(`./${a.path.slice(2)}`, { resolveDir: web, kind: a.kind }));
  },
};
const harness = `import { createRoot } from "react-dom/client";
import "@/components/blocks/blocks.css"; import "@/app/embed/embed.css";
import Widget from "@/app/embed/Widget";
createRoot(document.getElementById("root")).render(<Widget {...window.__PROPS} />);`;
const common = { bundle: true, minify: true, format: "iife", target: "es2019", jsx: "automatic", plugins: [at], logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"' }, loader: { ".tsx": "tsx", ".ts": "ts" } };
await esbuild.build({ ...common, stdin: { contents: harness, resolveDir: web, loader: "tsx", sourcefile: "harness.tsx" }, outdir: tmp, entryNames: "harness" });
// size of OUR client code (React and React DOM external: Next ships those in its shared runtime chunks)
const own = await esbuild.build({ ...common, write: false, external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
  stdin: { contents: harness, resolveDir: web, loader: "tsx", sourcefile: "harness.tsx" }, outdir: tmp, entryNames: "own" });
const gz = b => gzipSync(b, { level: 9 }).length;
const ownJs = own.outputFiles.find(f => f.path.endsWith(".js")).contents;
const fullJs = readFileSync(path.join(tmp, "harness.js"));
const loader = readFileSync(path.join(web, "public/embed.js"));
const sizes = { loader_gzip: gz(loader), widget_own_js_gzip: gz(ownJs), widget_plus_react_dom_gzip: gz(fullJs), css_gzip: gz(readFileSync(path.join(tmp, "harness.css"))) };

// ---------- the mock SAM origin ----------
const ROOTS = [
  { id: "lp-01", label: "Is Accops a real alternative to Citrix?" },
  { id: "lp-05", label: "Can we migrate off Citrix without downtime?" },
  { id: "lp-03", label: "How does Accops compare with Citrix feature by feature?" },
  { id: "lp-02", label: "Which Citrix components does Accops replace?" },
];
const CLICK = { "lp-01": "lp-01", "lp-03": "lp-03", "lp-05": "lp-05", "lp-02": "lp-02-stat", "lp-13": "lp-13", "lp-19": "lp-19", "lp-26": "lp-28", "lp-25": "lp-22", "lp-04": "partial", "lp-15": "partial" };
const TYPED = [[/replac/i, "picker", "intent"], [/bank|regulat/i, "lp-28", "intent"], [/nutanix|hypervisor/i, "partial", "model"], [/gateway|brochure|pdf/i, "lp-19", "intent"],
  [/discount|price/i, "fallback", "guard"], [/slow/i, "lp-22", "model"]];
const asks = [], events = [];
let HS = "";
const sam = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), send = (code, body, type = "application/json", h = {}) => { res.writeHead(code, { "Content-Type": type, ...h }); res.end(body); };
  const body = await new Promise(r => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => r(d)); });
  if (u.pathname === "/embed.js") return send(200, loader, "text/javascript");
  if (u.pathname === "/harness.js") return send(200, fullJs, "text/javascript");
  if (u.pathname === "/harness.css") return send(200, readFileSync(path.join(tmp, "harness.css")), "text/css");
  if (u.pathname === "/api/web/config")
    return send(200, JSON.stringify({ enabled: true, teaser: { after_s: 15, qa_id: ROOTS[0].id, label: ROOTS[0].label }, chips: ROOTS.slice(1, 3) }), undefined, { "Access-Control-Allow-Origin": "*" });
  if (u.pathname === "/api/web/event") { events.push({ origin: req.headers.origin ?? null, body: JSON.parse(body || "{}") }); return send(204, ""); }
  if (u.pathname === "/api/web/ask") {
    const b = JSON.parse(body);
    asks.push({ ...b, at: Date.now() });
    let id = "fallback", source = "fallback";
    if (b.turn.kind === "click") { id = CLICK[b.turn.qa_id] ?? "fallback"; source = id === "fallback" ? "fallback" : "bank"; }
    else { const m = TYPED.find(([re]) => re.test(b.turn.text)); if (m) [, id, source] = m; }
    await new Promise(r => setTimeout(r, source === "model" ? 1400 : 60));
    return send(200, JSON.stringify({ message_id: `m${asks.length}`, source, ...FX[id] }));
  }
  if (u.pathname === "/foreign") return send(200, "<script>parent.postMessage({t:'close'},'*');parent.postMessage({t:'cta',url:'#talk'},'*')</script>", "text/html");
  if (u.pathname === "/embed") {
    HS = `c_shots.${Date.now()}.mock`;
    const props = { conversationId: "c_shots", hs: HS, page: u.searchParams.get("page") ?? "", roots: ROOTS, origins: [lpOrigin],
      talk: { label: "Talk to an expert", url: "https://www.accops.com/schedule-a-free-demo" }, ask: u.searchParams.get("q") };
    return send(200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/harness.css"><style>html,body{margin:0}</style></head><body><div id="root"></div>
<script>window.__PROPS=${JSON.stringify(props).replace(/</g, "\\u003c")}</script><script src="/harness.js"></script></body></html>`, "text/html");
  }
  send(404, "not found", "text/plain");
});

// ---------- the LP origin (its folder, the embed tag pointed at the mock) ----------
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };
let teaserS = "2";
const lp = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(LPDIR, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(LPDIR) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  let data = readFileSync(f);
  if (f.endsWith("index.html")) {
    data = String(data).replace("https://sam-accops.vercel.app/embed.js", `${samOrigin}/embed.js`).replace('data-teaser="15"', `data-teaser="${teaserS}"`)
      .replace("</head>", "<style>.switcher{display:none!important}</style></head>"); // the LP's review-only angle switcher
    if (u.searchParams.has("noloader")) data = data.replace(/<script src="[^"]*embed\.js"[^>]*><\/script>/, "");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream" });
  res.end(data);
});
const listen = s => new Promise(r => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));
const samOrigin = await listen(sam), lpOrigin = await listen(lp);

// ---------- Chrome ----------
const { chromium } = createRequire(path.join(web, "package.json"))("playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = {}, shots = [];
const pass = (k, v, detail) => { results[k] = { ok: !!v, ...(detail === undefined ? {} : { detail }) }; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const CLS = "window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true});";

async function lpPage(width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 640 ? 812 : 800 }, deviceScaleFactor: width < 640 ? 2 : 1,
    isMobile: width < 640, hasTouch: width < 640, reducedMotion: opts.reducedMotion ?? "no-preference" });
  const page = await ctx.newPage();
  await page.addInitScript(CLS);
  await page.goto(`${lpOrigin}/${opts.query ?? ""}`, { waitUntil: "load" });
  return { ctx, page };
}
// The iframe lives in a closed shadow root: document.querySelector cannot see it, page.frames() can.
const embeds = page => page.frames().filter(f => f.url().startsWith(`${samOrigin}/embed`));
async function frameOf(page) { for (let i = 0; i < 100; i++) { const f = embeds(page)[0]; if (f) return f; await wait(100); } throw new Error("no /embed frame"); }
const shown = async fr => (await fr.frameElement()).evaluate(e => getComputedStyle(e).visibility === "visible");
const shot = async (page, name, opts = {}) => { const p = path.join(OUT, `web-widget-${name}.png`); await page.screenshot({ path: p, ...opts }); shots.push(path.relative(path.join(web, ".."), p).split(path.sep).join("/")); };
const hostOpen = page => page.evaluate(() => !!document.querySelector("[data-accops-chat]"));
// The closed shadow root is unreachable from the page (as intended), so the harness clicks by position.
const launcher = async page => { const v = page.viewportSize(); return { x: v.width - 24 - 28, y: v.height - 24 - 28 }; };

try {
  for (const width of [1280, 375]) {
    const W = String(width);
    // CLS with and without the loader (the loader's own share must be 0)
    const base = await lpPage(width, { query: "?noloader=1" });
    await wait(1500);
    const clsBase = await base.page.evaluate("window.__cls");
    await base.ctx.close();
    const { ctx, page } = await lpPage(width);
    await page.waitForFunction(() => !!document.querySelector("[data-accops-chat]"), null, { timeout: 10_000 });
    await wait(1200);
    pass(`${W}: loader adds no layout shift (CLS)`, (await page.evaluate("window.__cls")) - clsBase < 0.001, { with: await page.evaluate("window.__cls"), without: clsBase });
    pass(`${W}: no iframe before interaction`, embeds(page).length === 0 && page.frames().length === 1);
    await shot(page, `${W}-1-launcher`);

    // teaser: engage (scroll), then data-teaser=2 s of visible time
    await page.mouse.move(200, 200); await page.mouse.move(260, 240);
    if (width < 640) { await page.evaluate(() => window.scrollTo(0, 900)); await wait(400); }
    await wait(2600);
    pass(`${W}: popup_shown after the teaser delay`, (await page.evaluate(() => (window.dataLayer || []).some(e => e.sam_event === "popup_shown"))));
    await shot(page, `${W}-2-teaser`);
    pass(`${W}: still no iframe while the teaser shows`, embeds(page).length === 0);

    // open by keyboard? (desktop) / tap (mobile): the launcher
    const L = await launcher(page);
    if (width >= 640) {
      // keyboard: Shift+Tab from the page lands on the launcher (last in the tab order), Enter opens
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("Shift+Tab");
      const onHost = await page.evaluate(() => !!document.activeElement?.hasAttribute("data-accops-chat"));
      pass(`${W}: keyboard: the launcher is reachable with Tab and Enter opens it`, onHost);
      if (onHost) await page.keyboard.press("Enter"); else await page.mouse.click(L.x, L.y);
    } else {
      const lift = await page.evaluate(() => { const s = document.querySelector("[data-sticky]"); const r = s.getBoundingClientRect(); return r.top < innerHeight ? innerHeight - r.top : 0; });
      await page.mouse.click(L.x, L.y - lift);
    }
    const fr = await frameOf(page);
    await fr.waitForSelector(".w-hello");
    await wait(500);
    pass(`${W}: iframe created on the first click`, embeds(page).length === 1 && await shown(fr));
    if (width >= 640) pass(`${W}: keyboard: focus lands in the question box`, await fr.evaluate(() => document.activeElement?.id === "w-q"));
    if (width < 640) pass(`${W}: page scroll locked while the sheet is open`, (await page.evaluate(() => document.documentElement.style.overflow)) === "hidden");
    await shot(page, `${W}-3-open`);

    // a root question -> its answer (bank, no thinking state)
    await fr.click(".w-roots li:nth-child(1) button");
    await fr.waitForSelector(".w-bot .sb-answer");
    await wait(700);
    await shot(page, `${W}-4-answer-root`);

    // a chip -> the comparison (3 columns: a table at 1280's 400 px panel? no: the panel is 400 px, so cards)
    await fr.click(".sb-chip >> text=feature by feature");
    await fr.waitForFunction(() => document.querySelectorAll(".w-bot .sb-answer").length >= 2);
    await wait(700);
    const cards = await fr.evaluate(() => { const t = [...document.querySelectorAll("table.sb-cols-3")].at(-1); return t && getComputedStyle(t.querySelector("tbody tr")).display; });
    pass(`${W}: 3-column comparison renders as stacked cards in the panel`, cards === "grid", cards);
    const overflow = await fr.evaluate(() => [...document.querySelectorAll(".sb-scroll")].some(e => e.scrollWidth > e.clientWidth + 1));
    pass(`${W}: no sideways scroll in any comparison`, !overflow);
    pass(`${W}: collapsed row details stay hidden`, await fr.evaluate(() => [...document.querySelectorAll("tr.sb-detail[hidden]")].every(e => e.offsetHeight === 0)));
    await shot(page, `${W}-5-compare`);
    // expand a row's detail
    const rowBtn = await fr.$$(".sb-rowbtn");
    if (rowBtn.length) { await rowBtn.at(-1).click(); await wait(300); await shot(page, `${W}-6-compare-detail`); }

    // typed question -> stepper answer (prev, recent_ms, typed timing)
    const typed = "Which Citrix components would you replace for us?";
    await fr.fill("#w-q", typed);
    await fr.press("#w-q", "Enter");
    await fr.waitForFunction(() => document.querySelectorAll(".w-bot .sb-answer").length >= 3);
    await wait(700);
    await shot(page, `${W}-7-picker`);
    await fr.click(".sb-opt >> text=NetScaler");
    await fr.waitForFunction(() => document.querySelectorAll(".w-bot .sb-answer").length >= 4);
    await wait(800);
    await shot(page, `${W}-8-doc`);

    // a slow (model) answer: the thinking state, then the answer with its stat + source pill
    await fr.fill("#w-q", "Has anyone switched from Citrix to Accops? (slow)");
    await fr.press("#w-q", "Enter");
    await wait(width < 640 ? 950 : 900);
    await shot(page, `${W}-9-thinking`);
    await fr.waitForFunction(() => document.querySelectorAll(".w-bot .sb-answer").length >= 5);
    await wait(900);
    await shot(page, `${W}-10-stat`);
    const pillsOk = await fr.evaluate(() => [...document.querySelectorAll(".sb-text, .sb-stat")].every(b => { const p = b.querySelector(".sb-src"); if (!p) return false; const r = p.getBoundingClientRect(); return r.width > 40 && r.height >= 20 && getComputedStyle(p).visibility === "visible"; }));
    pass(`${W}: every Text and Stat shows a visible source pill`, pillsOk);

    // the ask bodies the widget sent
    const mine = asks.slice(-5);
    pass(`${W}: hs, parent, ms_since_render, recent_ms sent correctly`,
      mine.every(a => a.hs === HS && a.parent === true && a.ms_since_render > 300 && a.recent_ms.length >= 1 && a.recent_ms.length <= 6 && Math.abs(a.recent_ms.at(-1) - a.at) < 1000)
        && mine.map(a => a.recent_ms.length).join() === "1,2,3,4,5" && mine[2].turn.kind === "typed" && mine[4].prev === typed,
      mine.map(a => ({ turn: a.turn.kind, parent: a.parent, ms: a.ms_since_render, recent: a.recent_ms.length, prev: !!a.prev })));

    // analytics: dataLayer has no text field, never the typed words
    const dl = await page.evaluate(() => (window.dataLayer || []).filter(e => e.event === "sam_chat"));
    const allowed = new Set(["event", "sam_event", "sam_qa_id", "sam_source", "page_path", "gtm.uniqueEventId"]);
    pass(`${W}: dataLayer sam_chat events carry no text`, dl.length > 5 && dl.every(e => Object.keys(e).every(k => allowed.has(k)) && Object.values(e).every(v => typeof v !== "string" || !/\s/.test(v)))
      && !/components|switched/.test(JSON.stringify(dl)), dl.map(e => `${e.sam_event}${e.sam_qa_id ? `:${e.sam_qa_id}` : ""}${e.sam_source ? `/${e.sam_source}` : ""}`));
    pass(`${W}: event route never receives text`, events.every(e => !/components|switched/.test(JSON.stringify(e.body))));

    // a foreign postMessage is ignored (the page's own window, then a foreign-origin iframe)
    // the page itself, an opaque-origin frame, and a page on SAM's own origin that is not our iframe (right origin, wrong window)
    await page.evaluate(() => window.postMessage({ t: "close" }, "*"));
    await page.evaluate(sam => Promise.all([`data:text/html,<script>parent.postMessage({t:'close'},'*')<\/script>`, `${sam}/foreign`].map(src =>
      new Promise(r => { const f = document.createElement("iframe"); f.src = src; f.style.cssText = "position:absolute;width:1px;height:1px;left:-9px"; f.onload = () => setTimeout(r, 300); document.body.appendChild(f); }))), samOrigin);
    await wait(300);
    pass(`${W}: foreign-origin / foreign-window postMessage ignored`, await shown(fr));

    // Esc closes and focus returns to the launcher (the closed shadow root's host)
    await fr.press("#w-q", "Escape");
    await wait(400);
    pass(`${W}: Esc closes; focus back on the launcher`, await page.evaluate(() => document.activeElement?.hasAttribute("data-accops-chat") && document.documentElement.style.overflow !== "hidden"));
    await shot(page, `${W}-11-closed`);
    await ctx.close();
  }

  // reduced motion: the panel and teaser draw without animation (smoke)
  {
    const { ctx, page } = await lpPage(1280, { reducedMotion: "reduce" });
    await page.waitForFunction(() => !!document.querySelector("[data-accops-chat]"));
    const L = await launcher(page);
    await page.mouse.click(L.x, L.y);
    const fr = await frameOf(page);
    await fr.waitForSelector(".w-hello");
    pass("reduced motion: panel opens", true);
    await ctx.close();
  }
} finally {
  await browser.close();
  sam.close(); lp.close();
}
const failed = Object.entries(results).filter(([, r]) => !r.ok);
writeFileSync(path.join(OUT, "web-widget-shots.json"), JSON.stringify({ when: new Date().toISOString(), sizes, results, shots }, null, 2));
for (const [k, r] of Object.entries(results)) console.log(`${r.ok ? "ok  " : "FAIL"} ${k}${r.ok || r.detail === undefined ? "" : ` ${JSON.stringify(r.detail)}`}`);
console.log(`sizes (gzip): loader ${sizes.loader_gzip} B; widget code ${sizes.widget_own_js_gzip} B; widget + React DOM ${sizes.widget_plus_react_dom_gzip} B; CSS ${sizes.css_gzip} B`);
console.log(`${shots.length} screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
