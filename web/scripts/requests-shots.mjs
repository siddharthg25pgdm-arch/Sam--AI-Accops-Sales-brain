// The content-request loop end to end, in a real browser, with screenshots: a rep asks for something
// missing, sees substitutes and "Ask marketing to create this", files it, marketing marks it
// delivered on /admin, and the rep sees it in Your requests and as a notice in the chat.
// Same approach as admin-shots.mjs: system Chrome/Edge through playwright-core, no browser download.
// usage (from web/, against `next dev`, so everything is written is_test): node scripts/requests-shots.mjs http://localhost:3300 out/
// Signs in as the first admin in SAM_USERS from .env.local; the password is never printed.
import { chromium } from "playwright-core";
import fs from "node:fs";

const [base = "http://localhost:3300", out = "shots-requests"] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const admin = (env.SAM_USERS ?? "").split(",").map(s => s.trim().split(":")).find(p => p[2] === "admin");
if (!admin) throw new Error("no admin in SAM_USERS");
fs.mkdirSync(out, { recursive: true });
const channel = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge";
const browser = await chromium.launch({ channel, headless: true });
const ASK = "remote browser isolation brochure";
const TITLE = "Remote browser isolation brochure";

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
const shot = (page, name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const log = (...a) => console.log(...a);

// 1. The rep asks, gets substitutes and the button, files the request.
{
  const { ctx, page } = await session("light", 1440);
  await page.fill("input[aria-label='Ask SAM']", ASK);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".msg.sam .verdict", { timeout: 60_000 });
  log("verdict:", (await page.textContent(".msg.sam .verdict"))?.slice(0, 160), "scrollY:", await page.evaluate(() => window.scrollY));
  log("cards:", await page.$$eval(".msg.sam .result b", els => els.map(e => e.textContent)));
  log("trace:", await page.$$eval(".trace div", els => els.map(e => e.textContent.slice(0, 160))));
  await page.waitForSelector(".askmkt", { timeout: 5_000 });
  await shot(page, "1-missing-light-1440");
  await page.click("text=Ask marketing to create this");
  await page.waitForSelector(".askmkt.form input");
  log("prefilled title:", await page.inputValue(".askmkt.form input"), "scrollY after opening:", await page.evaluate(() => window.scrollY));
  await page.fill(".askmkt.form textarea", "For a BFSI prospect, needed before the 3 Oct demo");
  await shot(page, "2-form-light-1440");
  await page.keyboard.press("Escape");                       // keyboard: Esc closes the form
  await page.waitForSelector(".askmkt:not(.form)");
  log("esc closed form, focus on:", await page.evaluate(() => document.activeElement?.textContent), "scrollY:", await page.evaluate(() => window.scrollY));
  await page.keyboard.press("Enter");                        // keyboard: Enter on the focused button reopens it
  await page.waitForSelector(".askmkt.form");
  log("scrollY after reopening by keyboard:", await page.evaluate(() => window.scrollY));
  await page.fill(".askmkt.form textarea", "For a BFSI prospect, needed before the 3 Oct demo");
  log("scrollY before submit:", await page.evaluate(() => window.scrollY));
  await page.focus(".askmkt.form input");
  log("scrollY after focusing the title:", await page.evaluate(() => window.scrollY));
  await page.keyboard.press("Enter");                        // keyboard: Enter submits
  await page.waitForSelector(".askmkt.sent", { timeout: 20_000 });
  log("confirmation:", await page.textContent(".askmkt.sent"));
  log("window scrollY after sending:", await page.evaluate(() => window.scrollY));
  await shot(page, "3-sent-light-1440");
  await ctx.close();
}
// Dark + narrow views of the chat, with the form open.
for (const [scheme, width] of [["dark", 1440], ["light", 390]]) {
  const { ctx, page } = await session(scheme, width);
  await page.fill("input[aria-label='Ask SAM']", ASK);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".askmkt", { timeout: 60_000 });
  await page.click("text=Ask marketing to create this");
  await page.waitForSelector(".askmkt.form");
  await shot(page, `2-form-${scheme}-${width}`);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".askmkt.sent", { timeout: 20_000 });
  log(`${scheme}-${width} repeat:`, await page.textContent(".askmkt.sent p"));
  await shot(page, `3-sent-${scheme}-${width}`);
  await ctx.close();
}

// 2. Marketing sees it (dev writes is_test, so the test toggle is on), and marks it delivered.
for (const [scheme, width] of [["light", 1440], ["dark", 1440], ["light", 390]]) {
  const { ctx, page } = await session(scheme, width);
  await page.goto(`${base}/admin?tab=requests&test=1`);
  await page.waitForSelector(".dash");
  await shot(page, `4-admin-requests-${scheme}-${width}`, width > 500);
  if (scheme === "light" && width === 1440) {
    await page.goto(`${base}/admin?test=1`);
    await page.waitForSelector(".dash");
    await shot(page, "4-admin-overview-light-1440");
    await page.goto(`${base}/admin?tab=requests&test=1`);
    const li = page.locator(".reqs > li", { has: page.locator(`h3:text-is("${TITLE}")`) });
    await li.locator("summary").click();
    await li.locator("select[name=status]").selectOption("done");
    await shot(page, "5-admin-update-light-1440");
    await li.locator("button:text('Save')").click();          // no title or link: must refuse
    await page.waitForSelector(".notice[role=alert]");
    log("refused:", await page.textContent(".notice[role=alert]"));
    const li2 = page.locator(".reqs > li", { has: page.locator(`h3:text-is("${TITLE}")`) });
    await li2.locator("summary").click();
    await li2.locator("select[name=status]").selectOption("done");
    await li2.locator("input[name=delivered_title]").fill("Accops Remote Browser Isolation Brochure 2026 (TEST)");
    await li2.locator("input[name=delivered_url]").fill("https://downloads.accops.com/test/rbi-brochure-2026.pdf");
    await li2.locator("button:text('Save')").click();
    await page.waitForSelector(".ok-note");
    log("saved:", await page.textContent(".ok-note"));
    await page.goto(`${base}/admin?tab=requests&test=1&rv=done`);
    await shot(page, "6-admin-delivered-light-1440", true);
  }
  await ctx.close();
}

// 3. The rep's side: the quiet notice on the next visit, and Your requests.
{
  const { ctx, page } = await session("light", 1440);
  await page.waitForSelector(".delivered", { timeout: 10_000 }).catch(() => log("no delivered notice"));
  log("notice:", await page.textContent(".delivered").catch(() => null));
  await shot(page, "7-delivered-notice-light-1440");
  await page.goto(`${base}/requests`);
  await page.waitForSelector(".dash");
  await shot(page, "8-your-requests-light-1440", true);
  await page.goto(`${base}/`);
  log("notice after visiting Your requests:", await page.$(".delivered") ? "still shown" : "gone");
  await ctx.close();
}
for (const [scheme, width] of [["dark", 1440], ["light", 390], ["dark", 390]]) {
  const { ctx, page } = await session(scheme, width);
  await page.goto(`${base}/requests`);
  await page.waitForSelector(".dash");
  await shot(page, `8-your-requests-${scheme}-${width}`, true);
  await ctx.close();
}
await browser.close();
console.log("done", fs.readdirSync(out).length, "files");
