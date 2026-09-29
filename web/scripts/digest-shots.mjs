// Screenshots of rendered digest HTML files at email widths (600 desktop, 375 phone).
// usage: DIGEST_OUT=dir node lib/digest.check.mjs && node scripts/digest-shots.mjs dir
// Every dir/*.html becomes dir/<name>-600.png and dir/<name>-375.png. System Chrome/Edge, as admin-shots.mjs.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2] ?? "shots-digest";
const channel = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge";
const browser = await chromium.launch({ channel, headless: true });
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".html"))) {
  for (const width of [600, 375]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: width < 500 ? 2 : 1 });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.resolve(dir, f)).href);
    await page.screenshot({ path: path.join(dir, `${f.replace(/\.html$/, "")}-${width}.png`), fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log("done");
