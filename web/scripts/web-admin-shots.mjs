// Screenshots of the admin Website tab without `next dev` (the laptop cannot spare the RAM): WebsiteView is rendered to
// static HTML from fixtures (scripts/web-admin-fixture.mjs: synthetic traffic + the REAL draft bank) inside the admin
// shell, with the real CSS, served on localhost, and shot with the system Chrome through playwright-core.
// usage (from web/): node scripts/web-admin-shots.mjs [outdir=../docs/plans/shots]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import * as F from "./web-admin-fixture.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(web, "..", "docs", "plans", "shots"));
const tmp = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "wshots-"));
const stub = (n, s) => { const p = path.join(tmp, n); fs.writeFileSync(p, s); return p; };
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, alias: {
  "@/app/admin/website-actions": stub("a.mjs", "export const decidePair = '/x', draftPair = '/x', aliasPair = '/x', saveWebSettings = '/x';"),
  "@/app/admin/website.css": stub("e.mjs", "export default {};"), "@/components/blocks/blocks.css": stub("e2.mjs", "export default {};"),
  "next/font/google": stub("f.mjs", "export const Barlow = () => ({ variable: 'barlow' });"),
  "next/link": stub("l.mjs", "import { createElement } from 'react'; export default function Link(p) { return createElement('a', p); }"),
  "@": web } });
const React = await import("react"); const { renderToStaticMarkup } = await import("react-dom/server");
const W = await jiti.import("../lib/web-dashboard.ts"), V = await jiti.import("../app/admin/website.tsx"), { TopBar } = await jiti.import("../components/TopBar.tsx");

const NOW = Date.parse("2026-10-27T06:00:00Z");
const rows = F.busyRows(NOW), usage = F.busyUsage(rows, NOW);
const meta = JSON.parse(fs.readFileSync(path.join(web, "data", "web-qa-review.json"), "utf8"));
const blocked = [{ pattern: "\\mgartner\\M|magic quadrant|\\mMQ\\M", reason: "Gartner wording awaits legal (citation rules)", except_case_studies: false }];
const draftBank = F.bankRows(), approved = draftBank.filter(q => !["lp-04", "lp-15", "lp-24", "lp-31"].includes(q.id)).map(q => q.id);
const items = (b, live) => V.bankItems(b, live, blocked, F.SETTINGS, meta);
const href = o => `/admin?tab=website&${new URLSearchParams(Object.entries(o).filter(([, x]) => x != null).map(([k, x]) => [k, String(x)]))}`;
const base = { view: "analytics", label: "all", qaf: "draft", days: 30, includeTest: false, now: new Date(NOW).toISOString(), configured: true, chatOn: true, modelOffEnv: false,
  ok: "", err: "", back: "tab=website", href, dash: null, dashError: null, rows, rowsError: null, bank: null, bankError: null, settings: F.SETTINGS,
  index: { built_at: "2026-10-26T12:18:35+00:00", source: "draft-corpus", ids: draftBank.map(q => q.id) },
  leak: { job: "web_leak", started_at: "2026-10-26T03:30:00Z", finished_at: null, status: "ok", summary: "0 findings" }, leakReadable: true, oldest: "2026-10-13T08:00:00Z" };
const busyDash = W.mapDashboard(F.rawFromRows(rows, { days: 30, now: NOW, events: F.BUSY_EVENTS, usage }), base.now);
const PAGES = {
  "analytics": { ...base, dash: busyDash, bank: items(F.bankRows(approved), new Set(approved)) },
  "analytics-empty": { ...base, chatOn: false, dash: W.mapDashboard(F.EMPTY_RAW, base.now), rows: [], bank: items(draftBank, new Set()), leak: null, oldest: null },
  "approve": { ...base, view: "approve", bank: items(draftBank, new Set()) },
  "conversations": { ...base, view: "conversations" },
  "settings": { ...base, view: "settings", ok: "" },
};
const css = ["app/globals.css", "app/admin/website.css", "components/blocks/blocks.css"].map(f => fs.readFileSync(path.join(web, f), "utf8").replace(/^@import "tailwindcss";/m, "")).join("\n");
const page = d => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}\n.barlow{--sb-font:"Barlow"}</style></head><body>${renderToStaticMarkup(React.createElement(React.Fragment, null,
  React.createElement(TopBar, { user: { id: "siddharth", admin: true }, current: "admin" }),
  React.createElement("main", { className: "dash" },
    React.createElement("header", { className: "dash-head" }, React.createElement("div", null, React.createElement("h1", null, "Dashboard"),
      React.createElement("p", { className: "dash-sub" }, "Last 30 days · 28 Sep – 27 Oct · India time"))),
    React.createElement("nav", { className: "tabs-dash" }, ...["Overview", "Usage", "Quality", "Content", "Requests", "System", "Conversations", "Website"]
      .map(t => React.createElement("a", { key: t, href: "#", "aria-current": t === "Website" ? "page" : undefined }, t))),
    React.createElement(V.WebsiteView, { d })))) }</body></html>`;
const html = Object.fromEntries(Object.entries(PAGES).map(([k, d]) => [k, page(d)]));

const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  if (html[u.slice(1)]) { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return r.end(html[u.slice(1)]); }
  const f = path.join(web, "public", u);
  if (f.startsWith(path.join(web, "public")) && fs.existsSync(f) && fs.statSync(f).isFile()) { r.writeHead(200); return fs.createReadStream(f).pipe(r); }
  r.writeHead(404); r.end();
}).listen(4378);
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ channel: fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge", headless: true });
fs.mkdirSync(out, { recursive: true });
const shots = [];
try {
  for (const [name, scheme, width, maxH] of [["analytics", "light", 1440, 0], ["analytics", "dark", 1440, 0], ["analytics-empty", "light", 1440, 1300],
    ["approve", "light", 1440, 2600], ["approve", "light", 390, 2400], ["conversations", "light", 1440, 1400], ["settings", "light", 1440, 0], ["analytics", "light", 390, 2600]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: width < 500 ? 2 : 1 });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:4378/${name}`, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    const file = path.join(out, `web-admin-${name}-${scheme}-${width}.png`);
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.screenshot({ path: file, fullPage: true, ...(maxH ? { clip: { x: 0, y: 0, width, height: Math.min(maxH, h) } } : {}) });
    shots.push(path.relative(path.join(web, ".."), file));
    await ctx.close();
  }
} finally { await browser.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(shots.join("\n"));
