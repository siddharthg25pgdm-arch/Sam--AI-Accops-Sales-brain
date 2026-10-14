// Run: SAM_LIVE_E2E_ID=<id> SAM_LIVE_E2E_PW=<pw> [SAM_LIVE_E2E_SERVER=http://localhost:3000] [SAM_LIVE_EXE="dist/win-unpacked/SAM Live.exe"]
//      node test/e2e-real.check.mjs
// The whole thing for real: the app (packaged if SAM_LIVE_EXE is set), real Windows loopback, a real SAM server with
// real models. Plays a scripted customer out loud with the mic muted, checks transcripts and a live insight reach the
// overlay, ends the call and checks the summary. Prints the company it used so the caller can find and delete the rows
// (a `next dev` server marks them is_test). Credentials come from the environment only and are never printed.
import assert from 'node:assert';
import fs from 'node:fs';
import { synthesize, playThroughSpeakers } from './speech.mjs';
import { launch, pointAt, signIn, shot, visible, tempDir } from './harness.mjs';

const SERVER = process.env.SAM_LIVE_E2E_SERVER || 'http://localhost:3000';
const ID = process.env.SAM_LIVE_E2E_ID, PW = process.env.SAM_LIVE_E2E_PW;
assert.ok(ID && PW, 'set SAM_LIVE_E2E_ID and SAM_LIVE_E2E_PW');
const COMPANY = `E2E Northwind Co-op Bank ${Date.now() % 100000}`;
const CUSTOMER = [
  'Thanks for calling. We are a cooperative bank with about eight hundred users across forty branches.',
  'Today we use Citrix for remote access, but the licence renewal is in February and the cost has nearly doubled.',
  'Our last RBI inspection flagged that vendors reach the core banking servers without multi factor authentication.',
  'We are also evaluating Omnissa Horizon. Our CISO makes the final call, and I run the evaluation.',
  'If you can send pricing for eight hundred users next week, we could plan a pilot in December.',
];
const t0 = Date.now(), ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const work = tempDir('e2e'), profile = tempDir('profile');
const said = synthesize(CUSTOMER, work);
const { app, page } = await launch({ profile });
const count = sel => page.$$eval(sel, els => els.length);
try {
  await page.waitForSelector(visible('signin'));
  await pointAt(page, SERVER);
  await signIn(page, ID, PW);
  await page.waitForSelector(visible('start'), { timeout: 30_000 });
  const hint = await page.textContent('#audio-hint');
  assert.ok(!/Call audio unavailable/.test(hint), `system audio capture failed: ${hint}`);
  await page.fill('#company', COMPANY);
  await page.fill('#c-name', 'Asha Rao'); await page.fill('#c-title', 'Head of IT');
  await page.fill('#m-title', 'E2E discovery call');
  await page.click('#start-btn');
  await page.waitForSelector(visible('live'), { timeout: 30_000 });
  await page.click('#mute'); // the laptop mic would hear the speakers too; this run is about the customer channel
  await page.waitForTimeout(1500);
  console.log(`${ms()} call live on ${SERVER}, playing ${CUSTOMER.length} customer phrases through the speakers`);
  await playThroughSpeakers(said.map(s => s.file), 2500);
  await page.click('#transcript summary').catch(() => {});
  // every phrase should come back as a transcript line; uploads + transcription take a few seconds each
  await page.waitForFunction(n => document.querySelectorAll('#t-list li').length >= n, CUSTOMER.length, { timeout: 60_000 }).catch(() => {});
  const lines = await page.$$eval('#t-list li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log(`${ms()} transcript lines: ${lines.length}`); lines.forEach(l => console.log('   ', l.slice(0, 160)));
  const asks = await page.$$eval('#ask .q, #ask article, #ask li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  const cards = await count('#cards > *');
  const qual = await page.textContent('#q-count').catch(() => '');
  console.log(`${ms()} ask-next items: ${asks.length}, battlecards: ${cards}, qualification: ${qual}`); asks.slice(0, 3).forEach(a => console.log('    ask:', a.slice(0, 140)));
  await shot(page, 'e2e-real-live');
  assert.ok(lines.length >= CUSTOMER.length - 1, `expected ~${CUSTOMER.length} transcript lines, got ${lines.length}`);
  assert.ok(/citrix/i.test(lines.join(' ')) && /omnissa/i.test(lines.join(' ')), 'real transcription heard Citrix and Omnissa');
  assert.ok(asks.length > 0 || cards > 0, 'a live insight (ask next or battlecard) reached the overlay');

  await page.click('#end'); await page.click('#end');
  await page.waitForSelector(visible('ended'), { timeout: 120_000 });
  const score = await page.textContent('#score'), meta = await page.textContent('#ended-meta');
  const overview = await page.textContent('#overview'), subject = await page.textContent('#email-subj');
  console.log(`${ms()} ended: score ${score} | ${meta.replace(/\s+/g, ' ').trim()}`);
  console.log('    overview:', overview.replace(/\s+/g, ' ').trim().slice(0, 400));
  console.log('    follow-up subject:', subject.replace(/\s+/g, ' ').trim());
  await shot(page, 'e2e-real-ended');
  assert.ok(Number(score) >= 0 && Number(score) <= 100 && overview.trim().length > 40, 'a real summary came back');
  console.log(`e2e-real.check: passed - company "${COMPANY}"`);
} finally {
  await app.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true });
}
