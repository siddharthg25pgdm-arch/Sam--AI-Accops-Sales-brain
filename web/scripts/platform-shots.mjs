// Screenshots for the platform work: System (jobs + tokens) and Overview (split errors) wide, and the
// tab bar at 390 px. Same sign-in as admin-shots.mjs; the password is never printed.
// usage (from web/): node scripts/platform-shots.mjs http://localhost:3700 <out dir>
import { chromium } from "playwright-core";
import fs from "node:fs";

const [base = "http://localhost:3700", out = "shots-platform"] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const admin = (env.SAM_USERS ?? "").split(",").map(s => s.trim().split(":")).find(p => p[2] === "admin");
if (!admin) throw new Error("no admin in SAM_USERS");
fs.mkdirSync(out, { recursive: true });
const channel = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge";
const browser = await chromium.launch({ channel, headless: true });

for (const [width, shots] of [[1440, [["system", ""], ["overview", "test=1"], ["quality", "test=1"]]], [390, [["overview", ""], ["system", ""], ["conversations", ""]]]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: width < 500 ? 2 : 1 });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill("input[autocomplete=username]", admin[0]);
  await page.fill("input[type=password]", admin[1]);
  await page.click("form button");
  await page.waitForURL(`${base}/`);
  for (const [tab, q] of shots) {
    const t0 = Date.now();
    await page.goto(`${base}/admin?tab=${tab}${q ? `&${q}` : ""}`);
    await page.waitForSelector(".dash");
    const ms = Date.now() - t0;
    // At 390 px: is every tab link and the CSV row inside the viewport?
    const off = width < 500 ? await page.$$eval(".tabs-dash a", as => as.filter(a => { const r = a.getBoundingClientRect(); return r.right > innerWidth || r.left < 0; }).map(a => a.textContent)) : [];
    await page.screenshot({ path: `${out}/${tab}${q ? "-test" : ""}-${width}.png`, fullPage: width > 500 });
    if (width < 500) await page.locator(".tabs-dash").screenshot({ path: `${out}/${tab}-tabbar-${width}.png` });
    console.log(`${tab} ${width}px ${ms} ms${width < 500 ? ` · tab links off-screen: ${off.length ? off.join(", ") : "none"}` : ""}`);
  }
  await ctx.close();
}
await browser.close();
