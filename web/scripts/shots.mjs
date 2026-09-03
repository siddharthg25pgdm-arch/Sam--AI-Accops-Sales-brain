// Screenshots of the running app with the system browser (Edge or Chrome), no browser download.
// usage: node scripts/shots.mjs http://localhost:3010 siddharth sam-local-test out/
import { chromium } from "playwright-core";
import fs from "node:fs";

const [base = "http://localhost:3010", user = "siddharth", pass = "sam-local-test", out = "shots"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const channel = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge";
const browser = await chromium.launch({ channel, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${base}/login`);
await page.screenshot({ path: `${out}/1-login.png` });
await page.fill("input[autocomplete=username]", user);
await page.fill("input[type=password]", pass);
await page.click("form button");
await page.waitForURL(`${base}/`);
await page.waitForSelector(".doc");
await page.screenshot({ path: `${out}/2-home.png` });

await page.fill("input[aria-label='Ask SAM']", "Bank replacing Citrix, need a proof point");
await page.click(".composer button[type=submit]");
await page.waitForSelector(".result");
await page.click(".feedback button:first-of-type");
await page.click(".trace summary");
await page.screenshot({ path: `${out}/3-answer.png` });

await page.click(".views button:nth-child(3)");
await page.waitForSelector(".gap");
await page.screenshot({ path: `${out}/4-not-available.png` });

await page.click(".views button:nth-child(1)");
await page.click(".facet >> text=BFSI");
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/5-catalogue-bfsi.png` });

await page.goto(`${base}/admin`);
await page.waitForSelector(".stats");
await page.screenshot({ path: `${out}/6-admin.png`, fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/`);
await page.waitForSelector(".tabs");
await page.screenshot({ path: `${out}/7-mobile.png` });

await browser.close();
console.log("done", fs.readdirSync(out));
