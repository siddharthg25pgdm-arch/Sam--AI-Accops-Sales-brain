// End-to-end check of the feedback loop on a dev server, with screenshots. Same approach as
// requests-shots.mjs: system Chrome through playwright-core. Everything it creates is is_test (next dev).
// usage: node scripts/feedback-shots.mjs http://localhost:3500 out/
// Signs in as the admin and one other SAM_USERS entry from .env.local; passwords are never printed.
// Prints the event ids it rated, so the caller can clean them up.
import { chromium } from "playwright-core";
import fs from "node:fs";

const [base = "http://localhost:3500", out = "shots-feedback"] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const users = (env.SAM_USERS ?? "").split(",").map(s => s.trim().split(":"));
const admin = users.find(p => p[2] === "admin"), rep = users.find(p => p[2] !== "admin");
if (!admin || !rep) throw new Error("need an admin and one other user in SAM_USERS");
fs.mkdirSync(out, { recursive: true });
const channel = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge";
const browser = await chromium.launch({ channel, headless: true });
const rated = [];

async function session(who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill("input[autocomplete=username]", who[0]);
  await page.fill("input[type=password]", who[1]);
  await page.click("form button");
  await page.waitForURL(`${base}/`);
  return { ctx, page };
}

/** Ask, wait for the answer, press a rating; returns the answered event id. */
async function askAndRate(page, question, button, shot) {
  const answers = await page.locator(".msg.sam .feedback").count();
  await page.fill("input[aria-label='Ask SAM']", question);
  const res = page.waitForResponse(r => r.url().endsWith("/api/ask"), { timeout: 90_000 });
  await page.click(".composer button[type=submit]");
  const eventId = (await (await res).json()).eventId;
  await page.locator(".msg.sam .feedback").nth(answers).waitFor();
  const fb = page.waitForResponse(r => r.url().endsWith("/api/feedback"));
  await page.locator(".msg.sam").last().getByRole("button", { name: button, exact: true }).click();
  const body = await (await fb).json();
  await page.waitForTimeout(300);
  if (shot) await page.screenshot({ path: `${out}/${shot}.png`, fullPage: false });
  rated.push(eventId);
  console.log(`rated ${eventId} "${button}" -> ${JSON.stringify(body)}`);
  return { eventId, body };
}

const a = await session(admin);
const missing = await askAndRate(a.page, "Do we have an Arabic HySecure brochure?", "What I need doesn't exist", "1-chat-doesnt-exist");
await askAndRate(a.page, "Do we have an Arabic HySecure brochure?", "What I need doesn't exist");      // pressed twice: counts once
await askAndRate(a.page, "citrix battlecard for a bank", "Wrong asset", "2-chat-wrong-asset");
await askAndRate(a.page, "hyid datasheet", "Yes");

const r = await session(rep);
await askAndRate(r.page, "citrix comparison for banks", "Wrong asset", "3-chat-second-rep");
await askAndRate(r.page, "Arabic HySecure brochure please", "What I need doesn't exist");               // a second rep on the same request
await r.ctx.close();

const shots = [["4-quality", "tab=quality"], ["5-quality-test", "tab=quality&test=1"], ["6-quality-test-wrong", "tab=quality&test=1&fb=wrong_asset"],
  ["7-requests-real", "tab=requests"], ["8-requests-test", "tab=requests&test=1"], ["9-conversation", `tab=conversations&ev=${missing.eventId}`]];
for (const [name, q] of shots) {
  await a.page.goto(`${base}/admin?${q}`);
  await a.page.waitForSelector(".dash");
  await a.page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
const text = async q => { await a.page.goto(`${base}/admin?${q}`); return a.page.locator("main").innerText(); };
console.log("real quality shows test ratings:", (await text("tab=quality")).includes("citrix battlecard for a bank"));
const reqReal = await text("tab=requests"), reqTest = await text("tab=requests&test=1");
console.log("real queue shows the Arabic request:", /Arabic/i.test(reqReal), "| test queue:", /Arabic/i.test(reqTest));

const dj = await (await a.page.request.get(`${base}/api/v1/digest?format=json&test=1`)).json();
console.log("digest subject:", dj.subject, "| ratings:", JSON.stringify(dj.ratings && { ...dj.ratings, examples: dj.ratings.examples.map(x => x.question) }));
const dr = await (await a.page.request.get(`${base}/api/v1/digest?format=json`)).json();
console.log("digest without test ratings:", dr.subject, "| ratings:", dr.ratings);
await a.page.goto(`${base}/api/v1/digest?test=1`);
await a.page.screenshot({ path: `${out}/10-digest.png`, fullPage: true });

// Clear the first test demotion from the admin tab.
await a.page.goto(`${base}/admin?tab=quality&test=1`);
const clears = await a.page.locator("#demotions button").count();
if (clears) {
  await a.page.locator("#demotions button").first().click();
  await a.page.waitForSelector(".ok-note");
  await a.page.screenshot({ path: `${out}/11-cleared.png`, fullPage: true });
  console.log("demotions before clear:", clears, "after:", await a.page.locator("#demotions button").count());
} else console.log("no demotions to clear");
await a.ctx.close();
await browser.close();
console.log("event ids:", rated.join(","));
