// Screenshots of every dashboard tab, light and dark, wide and narrow. Same approach as shots.mjs:
// system Chrome/Edge through playwright-core, no browser download.
// usage: node scripts/admin-shots.mjs http://localhost:3100 out/ [query]
// Signs in as the first admin in SAM_USERS from .env.local; the password is never printed.
import { chromium } from "playwright-core";
import fs from "node:fs";

const [base = "http://localhost:3100", out = "shots-admin", extra = ""] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const admin = (env.SAM_USERS ?? "").split(",").map(s => s.trim().split(":")).find(p => p[2] === "admin");
if (!admin) throw new Error("no admin in SAM_USERS");
fs.mkdirSync(out, { recursive: true });
const channel = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge";
const browser = await chromium.launch({ channel, headless: true });

async function session(colorScheme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, deviceScaleFactor: width < 500 ? 2 : 1 });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill("input[autocomplete=username]", admin[0]);
  await page.fill("input[type=password]", admin[1]);
  await page.click("form button");
  await page.waitForURL(`${base}/`);
  return { ctx, page };
}

const tabs = ["overview", "usage", "quality", "content", "system", "conversations"];
for (const [scheme, width, only] of [["light", 1440, null], ["dark", 1440, null], ["light", 390, ["overview", "conversations"]], ["dark", 390, ["usage"]]]) {
  const { ctx, page } = await session(scheme, width);
  for (const t of tabs) {
    if (only && !only.includes(t)) continue;
    await page.goto(`${base}/admin?tab=${t}${extra ? `&${extra}` : ""}`);
    await page.waitForSelector(".dash");
    await page.screenshot({ path: `${out}/${t}-${scheme}-${width}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log("done", fs.readdirSync(out).length, "files");
