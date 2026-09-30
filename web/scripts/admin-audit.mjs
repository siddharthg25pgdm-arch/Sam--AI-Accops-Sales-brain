// Dashboard audit: every tab x period x test toggle, timed; KPI text pulled out; screenshots light/dark
// at 1440 and 390; internal links checked; console errors and horizontal overflow recorded.
// usage (from web/, dev server running): node scripts/admin-audit.mjs http://localhost:3600 out/
// Signs in as the first admin in SAM_USERS from .env.local; the password is never printed.
import { chromium } from "playwright-core";
import fs from "node:fs";

const [base = "http://localhost:3600", out = "audit-admin"] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const admin = (env.SAM_USERS ?? "").split(",").map(s => s.trim().split(":")).find(p => p[2] === "admin");
if (!admin) throw new Error("no admin in SAM_USERS");
fs.mkdirSync(out, { recursive: true });
const channel = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge";
const browser = await chromium.launch({ channel, headless: true });
const report = { timings: [], kpis: {}, console: [], overflow: [], links: [], texts: {} };

async function session(colorScheme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, deviceScaleFactor: width < 500 ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error") report.console.push(`${page.url().replace(base, "")} :: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", e => report.console.push(`${page.url().replace(base, "")} :: pageerror ${e.message.slice(0, 300)}`));
  await page.goto(`${base}/login`);
  await page.fill("input[autocomplete=username]", admin[0]);
  await page.fill("input[type=password]", admin[1]);
  await page.click("form button");
  await page.waitForURL(`${base}/`);
  return { ctx, page };
}

const tabs = ["overview", "usage", "quality", "content", "requests", "system", "conversations"];
const { ctx, page } = await session("light", 1440);
// Warm-up: compile every tab once so the timings measure the server, not webpack.
for (const t of tabs) await page.goto(`${base}/admin?tab=${t}`, { timeout: 180_000 });
for (const t of tabs) for (const days of [7, 30, 90]) for (const test of [false, true]) {
  const url = `${base}/admin?tab=${t}&days=${days}${test ? "&test=1" : ""}`;
  const t0 = Date.now();
  const resp = await page.goto(url, { timeout: 120_000 });
  await page.waitForSelector(".dash");
  report.timings.push({ tab: t, days, test, status: resp.status(), ms: Date.now() - t0 });
  report.kpis[`${t}|${days}|${test ? "test" : "real"}`] = await page.$$eval(".kpi", els => els.map(e => [e.querySelector(".kl")?.textContent, e.querySelector(".kv")?.textContent, e.querySelector(".kpi-foot")?.textContent, e.querySelector(".kpi-delta")?.textContent].filter(Boolean).join(" | ")));
  if (days !== 30 || test) continue;
  report.texts[t] = (await page.$eval("main.dash", e => e.innerText)).slice(0, 8000);
  await page.screenshot({ path: `${out}/${t}-light-1440.png`, fullPage: true });
  for (const h of await page.$$eval("a[href]", as => [...new Set(as.map(a => a.getAttribute("href")))])) {
    if (!h || h.startsWith("#") || (/^https?:\/\//.test(h) && !h.startsWith(base))) continue;
    const u = new URL(h, base).toString();
    if (report.links.some(l => l.url === u.replace(base, ""))) continue;
    const t1 = Date.now();
    const r = await ctx.request.get(u, { maxRedirects: 0, timeout: 120_000 }).catch(e => ({ status: () => `ERR ${e.message.slice(0, 80)}`, headers: () => ({}) }));
    report.links.push({ from: t, url: u.replace(base, ""), status: r.status(), type: r.headers()["content-type"] ?? "", ms: Date.now() - t1 });
  }
}
await ctx.close();

for (const [scheme, width] of [["dark", 1440], ["light", 390], ["dark", 390]]) {
  const s = await session(scheme, width);
  for (const t of tabs) {
    await s.page.goto(`${base}/admin?tab=${t}`, { timeout: 120_000 });
    await s.page.waitForSelector(".dash");
    const ov = await s.page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      // Outermost elements sticking out of the viewport (children of an overflowing parent are skipped).
      const wide = [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > w + 1)
        .filter(e => !(e.parentElement && e.parentElement.getBoundingClientRect().right > w + 1))
        .slice(0, 6).map(e => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""} right=${Math.round(e.getBoundingClientRect().right)} "${(e.textContent ?? "").trim().slice(0, 40)}"`);
      return { scrollW: document.documentElement.scrollWidth, w, wide };
    });
    if (ov.scrollW > ov.w || ov.wide.length) report.overflow.push({ tab: t, scheme, width, ...ov });
    await s.page.screenshot({ path: `${out}/${t}-${scheme}-${width}.png`, fullPage: true });
  }
  await s.ctx.close();
}
await browser.close();
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
console.log("done", fs.readdirSync(out).length, "files");
