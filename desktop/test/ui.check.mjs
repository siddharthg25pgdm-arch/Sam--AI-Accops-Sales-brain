// Run: node desktop/test/ui.check.mjs - drives the real app (playwright-core _electron) against the stub server:
// sign in -> start (deal autocomplete, meters) -> live (insights, injected upload failures) -> end -> summary,
// then a call the app lost is offered for resume and summarised. Screenshots -> shots/live-desktop/.
// The mic is Chromium's fake device playing SAPI speech, so the whole VAD -> WAV -> upload path runs for real.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { startStub } from '../scripts/stub-server.mjs';
import { synthesize, joinWithSilence } from './speech.mjs';
import { launch, pointAt, signIn, shot, visible, tempDir } from './harness.mjs';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok ${n} - ${m}`); };
const stub = await startStub(), work = tempDir('ui'), profile = tempDir('profile');
const lines = synthesize([
  'Hi, thanks for joining. Could you tell me how remote access works for your teams today?',
  'Got it. And roughly how many people would need access on day one?',
  'Is there a budget set aside for this in the current financial year?',
  'Understood. Who else will be part of the evaluation?',
], work);
const fakeMic = ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${joinWithSilence(lines, 1500, path.join(work, 'mic.wav'))}`];
let { app, page } = await launch({ profile, args: fakeMic });
const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText());

try {
  // ---- sign in
  await page.waitForSelector(visible('signin'));
  await pointAt(page, stub.url);
  await page.fill('#signin-id', 'siddharth'); await page.fill('#signin-pw', 'secret');
  await shot(page, '01-sign-in');
  await signIn(page, 'siddharth', 'wrong');
  await page.waitForSelector('#signin-err:not([hidden])');
  ok(/match/.test(await page.textContent('#signin-err')), 'wrong password refused with a plain message');
  await shot(page, '01b-sign-in-error');
  await signIn(page);
  await page.waitForSelector(visible('start'));
  ok(true, 'signed in -> Start call');

  // ---- start call
  await page.click('#company'); await page.keyboard.type('north');
  await page.waitForSelector('#deals li');
  ok((await page.textContent('#deals')).includes('Northwind Bank'), 'company autocomplete from GET /deals?q=');
  await shot(page, '02-start-autocomplete');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForSelector('#deal-note:not([hidden])');
  await page.fill('#m-title', 'Discovery call');
  await page.waitForFunction(() => Number(/scaleX\(([\d.]+)/.exec(document.getElementById('lvl-rep').style.transform)?.[1]) > 0.2, null, { timeout: 20000 });
  ok(true, 'mic level meter moves with the (fake) mic speech');
  const hint = await page.textContent('#audio-hint');
  ok(!/unavailable/.test(hint), `mic and system audio both granted (${hint})`);
  await shot(page, '03-start-ready');

  // ---- live: the first two clips hit a 503 and must be retried in order
  stub.failNext(2);
  await page.click('#start-btn');
  await page.waitForSelector(visible('live'));
  ok(await page.textContent('#bar-name') === 'Northwind Bank', 'live header shows the company');
  ok(stub.meetings.size === 1 && [...stub.meetings.values()][0].request.deal_id === 'd-northwind', 'POST /meetings sent the picked deal_id');
  ok(await page.$$eval('.qi[data-s="done"]', els => els.length) === 1, "qualification carried over from the deal's last call");
  await shot(page, '04-live-listening');
  await page.waitForSelector('#sync[data-state="retry"]', { timeout: 30000 });
  ok(true, 'sync status shows Offline while uploads fail');
  await page.waitForSelector('.card.ask', { timeout: 60000 });
  ok(true, 'insight arrived: Ask next cards');
  await page.waitForSelector('.alert', { timeout: 90000 });
  ok((await page.$$eval('.card.battle .t', els => els.map(e => e.textContent))).join(' | ').startsWith('RBI data-localisation checklist for HySecure | Accops vs Citrix'),
    'second insight: new battlecard on top, earlier one kept, plus an alert');
  await page.waitForSelector('#sync[data-state="ok"]');
  await shot(page, '05-live-insights');
  await page.click('.qi[data-s="done"]');
  await page.waitForSelector('#q-detail:not([hidden])');
  ok((await page.textContent('#q-detail')).includes('“'), 'qualification item expands to value + evidence quote');
  await page.click('#mute');
  ok(await page.getAttribute('#mute', 'aria-pressed') === 'true', 'mute toggles');
  await shot(page, '06-live-detail-muted');
  await page.click('#transcript summary'); // stays muted through End on purpose: mute must not leak into the next call
  ok(await page.$$eval('#t-list li', els => els.length) >= 6, 'transcript lists the returned segments');
  await shot(page, '07-live-transcript');

  const ups = stub.uploads;
  const failed = ups.filter(u => u.status === 503);
  ok(failed.length === 2, 'two uploads failed (injected)');
  ok(failed.every(f => ups.some(u => u.status === 200 && u.channel === f.channel && u.t_ms === f.t_ms)), 'each failed clip was retried and accepted');
  for (const ch of ['rep', 'customer']) {
    const t = ups.filter(u => u.channel === ch && u.status === 200).map(u => u.t_ms);
    ok(t.every((v, i) => !i || v > t[i - 1]), `${ch}: accepted clips arrive in order (${t.length})`);
  }
  ok(ups.every(u => u.type === 'audio/wav' && Math.abs(u.wav_ms - u.duration_ms) <= 1 && u.duration_ms >= 1200 && u.duration_ms <= 15000),
    `every upload is a WAV whose length matches duration_ms, 1.2-15 s (${ups.map(u => u.duration_ms).join(', ')})`);

  // ---- end -> summary
  stub.slowEnd(2500);
  await page.click('#end');
  ok(await page.textContent('#end') === 'Confirm end', 'End call needs a second tap');
  await page.click('#end');
  await page.waitForSelector(visible('ending'));
  await shot(page, '08-ending');
  await page.waitForSelector(visible('ended'), { timeout: 60000 });
  stub.slowEnd(0);
  ok(await page.textContent('#score') === '72' && (await page.textContent('#ended-meta')).includes('emailed'), 'summary: deal score and flow status');
  await shot(page, '09-ended');
  await page.click('#copy-email');
  ok((await app.evaluate(({ clipboard }) => clipboard.readText())).startsWith('Subject: Accops and Northwind Bank'), 'Copy puts the follow-up email on the clipboard');

  await page.click('#new-call');
  await page.waitForFunction(() => Number(/scaleX\(([\d.]+)/.exec(document.getElementById('lvl-rep').style.transform)?.[1]) > 0.2, null, { timeout: 20000 });
  ok(await page.inputValue('#company') === '', 'next call starts clean: form reset, mic live again (mute did not leak)');
  const winCall = fn => app.evaluate(({ BrowserWindow }, f) => new Function('w', `return (${f})(w)`)(BrowserWindow.getAllWindows()[0]), fn.toString());
  await page.click('#btn-close');
  ok(await winCall(w => !w.isVisible()), 'close hides the window to the tray; the app keeps running');
  await page.waitForTimeout(800);
  const flat = await page.$eval('#lvl-rep', el => el.style.transform);
  ok(flat === 'scaleX(0)', `hidden on Start: the mic preview is released (meter ${flat})`);
  await winCall(w => w.show());
  await winCall(w => w.setBounds({ x: 140, y: 90, width: 420, height: 700 }));
  await page.waitForTimeout(900); // bounds are saved 400 ms after the last move/resize
  await page.click('#btn-settings');
  await page.waitForSelector(visible('settings'));
  await shot(page, '10-settings');
  await page.click('#settings-done');

  // ---- a call the app loses (crash, reboot) is offered back on the next launch
  await page.fill('#company', 'Tailspin Systems'); await page.fill('#c-name', 'Anita Desai'); await page.fill('#c-title', 'VP IT');
  await page.click('#start-btn');
  await page.waitForSelector(visible('live'));
  const lost = [...stub.meetings.values()].at(-1);
  ok(lost.request.company === 'Tailspin Systems' && lost.request.contact_title === 'VP IT', 'new company + contact sent to POST /meetings');
  await app.close();
  ({ app, page } = await launch({ profile, args: fakeMic }));
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  ok(b.x === 140 && b.y === 90 && b.width === 420 && b.height === 700, `window position and size remembered across launches (${JSON.stringify(b)})`);
  await page.waitForSelector('#resume:not([hidden])');
  ok(await page.textContent('#resume-name') === 'Tailspin Systems', 'lost live call offered for resume (GET /meetings/:id)');
  await shot(page, '11-start-resume');
  await page.click('#resume-end');
  await page.waitForSelector(visible('ended'));
  ok(lost.status === 'ended', 'End and summarise closed it on the server');
} finally {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), clipboardBefore).catch(() => {});
  await app.close().catch(() => {});
  await stub.close();
}

// The bearer token must never be on disk in clear text, anywhere in the profile (settings, localStorage, caches).
const leaks = fs.readdirSync(profile, { recursive: true }).map(f => path.join(profile, f))
  .filter(f => fs.statSync(f).isFile() && fs.statSync(f).size < 50e6 && fs.readFileSync(f).includes('stub-token'));
ok(leaks.length === 0 && fs.existsSync(path.join(profile, 'session.bin')), `token stored only DPAPI-encrypted (${leaks.join(', ') || 'no plain copies'})`);
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true });
console.log(`ui.check: ${n} assertions passed`);
