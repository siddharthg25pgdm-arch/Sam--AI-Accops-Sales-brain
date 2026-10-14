// Run: node desktop/test/ui.check.mjs - drives the real app (playwright-core _electron) against the stub server:
// sign in -> start (deal autocomplete, meters) -> live (insights, injected upload failures, echo drops, can't-hear
// banner, mic hot-swap, say-next, Ask SAM, quality pill, "Call ended?") -> end -> summary -> invisible mode, then a
// call the app lost is offered for resume and summarised, and a call ends by itself. Screenshots -> shots/live-desktop/.
// The mic is Chromium's fake device playing SAPI speech, so the whole VAD -> WAV -> upload path runs for real.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { startStub } from '../scripts/stub-server.mjs';
import { synthesize, joinWithSilence } from './speech.mjs';
import { launch, pointAt, signIn, shot, visible, tempDir, onOverlay } from './harness.mjs';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok ${n} - ${m}`); };
const stub = await startStub(), work = tempDir('ui'), profile = tempDir('profile');
const lines = synthesize([
  'Hi, thanks for joining. Could you tell me how remote access works for your teams today?',
  'Got it. And roughly how many people would need access on day one?',
  'Is there a budget set aside for this in the current financial year?',
  'Understood. Who else will be part of the evaluation?',
], work);
const fakeMic = ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${joinWithSilence(lines, 1500, path.join(work, 'mic.wav'))}`];
let { app, page, cap } = await launch({ profile, args: fakeMic });
const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText());
const opened = () => app.evaluate(() => globalThis.__opened);
const detector = e => onOverlay(app, (w, ev) => w.webContents.send('detector', ev), e); // what main sends when the registry changes
const meterAbove = (id, v) => page.waitForFunction(([i, x]) => Number(/scaleX\(([\d.]+)/.exec(document.getElementById(i).style.transform)?.[1]) > x, [id, v], { timeout: 20000 });
await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async u => { globalThis.__opened.push(u); }; }); // no real browser tabs

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
  await page.click('#btn-settings');
  await page.waitForSelector(visible('settings'));
  ok(await page.isChecked('#auto'), 'auto mode (start/end calls by themselves) is on by default');
  await page.click('#auto'); // the calls below test the manual flow: Start form, "Call ended?" prompt
  await page.click('#settings-done');
  await page.waitForSelector(visible('start'));

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

  // ---- the server drops an echo clip and later removes an echo line it had kept
  stub.echoNext(1);
  for (let i = 0; i < 60 && !stub.uploads.some(u => u.dropped); i++) await page.waitForTimeout(500);
  stub.removeNext();
  for (let i = 0; i < 60 && !stub.uploads.some(u => u.removed); i++) await page.waitForTimeout(500);
  const meeting1 = [...stub.meetings.values()][0], removedId = stub.uploads.find(u => u.removed)?.removed[0];
  await page.waitForFunction(n => document.querySelectorAll('#t-list li').length === n, meeting1.segments.length, { timeout: 10000 }).catch(() => {});
  const shownIds = await page.$$eval('#t-list li', els => els.map(e => e.dataset.id));
  ok(stub.uploads.some(u => u.dropped === 'echo') && removedId != null && !shownIds.includes(String(removedId)) && shownIds.length === meeting1.segments.length,
    `echo: a dropped clip adds no line, removed_segment_ids takes line ${removedId} out (${shownIds.length} lines = server's ${meeting1.segments.length})`);

  // ---- call-audio health. Chromium's fake devices feed the loopback too, so the detection itself is covered by
  // echo.check (CallHealth); here the capture window's verdict is injected to check the banner.
  const health = v => onOverlay(app, (w, x) => w.webContents.send('capture', { type: 'health', customerSilent: x }), v);
  await health(true);
  await page.waitForSelector('#health:not([hidden])');
  ok((await page.textContent('#health')).includes("Can't hear the call. Is Teams playing on a different speaker than Windows' default?"), 'call audio silent while the mic talks -> "Can\'t hear the call" banner');
  await shot(page, '05b-live-cant-hear');
  await page.click('#health-x');
  ok(await page.isHidden('#health'), 'banner dismisses (and stays dismissed for this call)');
  await health(false); await health(true);
  ok(await page.isHidden('#health'), 'a dismissed banner does not come back in the same call');

  // ---- mic hot-swap: the track ends (headset unplugged) -> re-acquired, the call keeps going
  await cap.evaluate(() => samCapture.micTrack().dispatchEvent(new Event('ended')));
  await page.waitForSelector('#toast:has-text("Reconnecting")', { timeout: 3000 });
  await page.waitForSelector('#toast:has-text("Microphone reconnected")', { timeout: 6000 });
  await meterAbove('mlvl-rep', 0.2);
  ok(await page.isVisible(visible('live')), 'mic dropped mid-call: "Reconnecting" -> "reconnected", levels back, still live');

  // ---- What do I say next?
  stub.assistDelay(1500);
  await page.click('#assist-next');
  await page.waitForSelector('.ao-wait');
  ok(await page.isDisabled('#assist-next'), 'say-next: spinner while SAM thinks, button disabled');
  await shot(page, '05c-live-say-next-loading');
  await page.waitForSelector('.card.say .line');
  ok((await page.textContent('.card.say .line')).startsWith('You mentioned the March renewal') && await page.textContent('.card.say .intent') === 'Discovery'
    && (await page.textContent('.card.say .why')).includes('urgency'), 'say-next shows the line, its intent and why');
  ok(await page.isDisabled('#assist-next'), 'say-next: 3 s cooldown after an answer');
  await shot(page, '05d-live-say-next');
  await page.waitForFunction(() => !document.getElementById('assist-next').disabled, null, { timeout: 4000 });
  ok(stub.assists.length === 1 && stub.assists[0].question === '', 'one POST /assist with no question');

  // ---- Ask SAM... -> SAM cards first, then the web answer, labelled, with links that open in the browser
  stub.assistDelay(300);
  await page.fill('#ask-q', 'How do we compare with Citrix on cost?');
  await page.press('#ask-q', 'Enter');
  await page.waitForSelector('.card.web');
  const order = await page.$$eval('#assist-out .card', els => els.map(e => e.classList.contains('web') ? 'web' : e.classList.contains('battle') ? 'card' : 'other'));
  ok(order.join() === 'card,web', `search: SAM card then web answer (${order})`);
  ok(await page.textContent('.web-label') === 'From the web — check before sharing', 'web answer labelled "From the web — check before sharing"');
  ok(await page.$$eval('.sources li', els => els.length) === 3 && await page.$$eval('.sources button', els => els.length) === 2, 'only http(s) sources are links (javascript: shown as text)');
  await shot(page, '05e-live-ask-sam');
  await page.click('.sources button');
  ok((await opened()).at(-1) === 'https://example.com/citrix-licensing', 'a source opens in the default browser');
  ok(stub.assists.at(-1).question === 'How do we compare with Citrix on cost?', 'POST /assist carried the question');
  await page.click('#assist-out .x');
  ok(await page.isHidden('#assist-out'), 'results close');

  // ---- call detection: the meeting app let go of the mic -> "Call ended?"; Keep listening / back on the mic clear it
  await detector({ type: 'using', apps: ['Teams'] });
  await detector({ type: 'released', app: 'Teams', autoEndMs: 600000 });
  await page.waitForSelector('#call-ended:not([hidden])');
  ok((await page.textContent('#call-ended')).includes('Teams has let go of the microphone'), '"Call ended?" prompt when Teams releases the mic');
  await shot(page, '05g-live-call-ended');
  await page.click('#ce-keep');
  ok(await page.isHidden('#call-ended'), 'Keep listening dismisses it');
  await detector({ type: 'released', app: 'Teams', autoEndMs: 600000 });
  await page.waitForSelector('#call-ended:not([hidden])');
  await detector({ type: 'back', app: 'Teams' });
  ok(await page.isHidden('#call-ended'), 'Teams back on the mic clears it');
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
  // Floor 0.9 s = 600 ms speech + 300 ms tail: the 300 ms pre-roll is shorter when speech restarts right after an
  // utterance closed. Chromium's fake devices feed the same file to mic and loopback, so AEC3 + the gate cut the rep
  // channel into such fragments here (a real mic never equals the loopback).
  ok(ups.every(u => u.type === 'audio/wav' && Math.abs(u.wav_ms - u.duration_ms) <= 1 && u.duration_ms >= 900 && u.duration_ms <= 15000),
    `every upload is a WAV whose length matches duration_ms, 0.9-15 s (${ups.map(u => `${u.channel[0]}${u.duration_ms}`).join(', ')})`);

  // ---- connection pill: red while uploads fail (assist disabled), yellow after (muted, so unmute for clips to flow)
  await page.click('#mute');
  stub.failNext(3);
  await page.waitForSelector('#sync[data-q="red"]', { timeout: 30000 });
  ok(await page.isDisabled('#assist-next') && await page.isDisabled('#ask-q'), 'pill red while SAM is unreachable: assist disabled');
  await shot(page, '05f-live-offline');
  await page.waitForSelector('#sync[data-state="ok"][data-q="yellow"]', { timeout: 60000 });
  ok(!(await page.isDisabled('#assist-next')), 'back online: pill yellow (settling), assist enabled again');
  await page.click('#mute');


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
  const winCall = fn => onOverlay(app, fn);
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
  // ---- invisible mode: on by default; the overlay really is missing from a screen capture, and the toggle works
  ok(await page.isChecked('#invisible') && await winCall(w => w.isContentProtected()), 'invisible mode on by default (content protection)');
  const grab = () => app.evaluate(async ({ desktopCapturer, screen, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('/index.html'));
    const b = w.getBounds(), d = screen.getDisplayMatching(b);
    const [src] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: d.size });
    return [...src.thumbnail.crop({ x: b.x - d.bounds.x, y: b.y - d.bounds.y, width: b.width, height: b.height }).toBitmap()];
  });
  // Compared with the same screen area with the overlay hidden (whatever window is behind it): with protection on a
  // capture must look like the empty background, with it off like the overlay. Mean absolute difference per channel.
  const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
  await winCall(w => w.hide());
  await page.waitForTimeout(700);
  const background = await grab();
  await winCall(w => w.show());
  await page.waitForTimeout(700);
  const protectedCap = await grab();
  await page.click('#invisible');
  await page.waitForTimeout(700);
  ok(!(await page.isChecked('#invisible')) && !(await winCall(w => w.isContentProtected())), 'toggle off: content protection off');
  const plainCap = await grab();
  const dOn = diff(protectedCap, background), dOff = diff(plainCap, background);
  ok(dOn < 4 && dOff > 8, `screen capture vs the background behind the overlay: protection on ${dOn.toFixed(1)} (overlay absent), off ${dOff.toFixed(1)} (overlay captured)`);
  await shot(page, '10-settings');
  await page.click('#invisible');
  ok(await page.isChecked('#invisible') && await winCall(w => w.isContentProtected()), 'toggle back on');
  await page.click('#settings-done');

  // ---- a call the app loses (crash, reboot) is offered back on the next launch
  await page.fill('#company', 'Tailspin Systems'); await page.fill('#c-name', 'Anita Desai'); await page.fill('#c-title', 'VP IT');
  await page.click('#start-btn');
  await page.waitForSelector(visible('live'));
  const lost = [...stub.meetings.values()].at(-1);
  ok(lost.request.company === 'Tailspin Systems' && lost.request.contact_title === 'VP IT', 'new company + contact sent to POST /meetings');
  // the overlay crashes/reloads mid-call: capture (its own hidden window) keeps going, Resume picks the call back up
  const micTrackBefore = await cap.evaluate(() => samCapture.micTrack()?.id);
  await onOverlay(app, w => w.webContents.reload());
  await page.waitForSelector('#resume:not([hidden])');
  ok(await cap.evaluate(() => samCapture.micTrack()?.readyState) === 'live' && await cap.evaluate(() => samCapture.micTrack()?.id) === micTrackBefore,
    'overlay reload mid-call: the capture window kept the same mic running');
  const before = stub.uploads.filter(u => u.meeting === lost.id).length;
  await page.click('#resume-go');
  await page.waitForSelector(visible('live'));
  for (let i = 0; i < 40 && stub.uploads.filter(u => u.meeting === lost.id).length === before; i++) await page.waitForTimeout(500);
  ok(stub.uploads.filter(u => u.meeting === lost.id).length > before, 'Resume: clips for the same meeting flow again');
  await app.close();
  ({ app, page, cap } = await launch({ profile, args: fakeMic }));
  const b = await onOverlay(app, w => w.getBounds());
  ok(b.x === 140 && b.y === 90 && b.width === 420 && b.height === 700, `window position and size remembered across launches (${JSON.stringify(b)})`);
  await page.waitForSelector('#resume:not([hidden])');
  ok(await page.textContent('#resume-name') === 'Tailspin Systems', 'lost live call offered for resume (GET /meetings/:id)');
  await shot(page, '11-start-resume');
  await page.click('#resume-end');
  await page.waitForSelector(visible('ended'));
  ok(lost.status === 'ended', 'End and summarise closed it on the server');

  // ---- "Call ended?" left unanswered: the call app stays off the mic and nobody speaks -> ends by itself
  await page.click('#new-call');
  await page.fill('#company', 'Auto-end test');
  await page.click('#start-btn');
  await page.waitForSelector(visible('live'));
  await page.click('#mute');
  await onOverlay(app, (w, ev) => w.webContents.send('detector', ev), { type: 'released', app: 'Zoom', autoEndMs: 2500 });
  await page.waitForSelector(visible('ended'), { timeout: 30000 });
  ok([...stub.meetings.values()].at(-1).status === 'ended', 'unanswered + silent -> the call ends and is summarised by itself');

  // ---- auto mode: a Phone Link call takes the mic -> the call starts by itself; "Who's this?" -> PATCH;
  // the app lets go -> 15 s countdown (Keep listening cancels) -> ends and summarises by itself
  await page.click('#new-call');
  await page.click('#btn-settings');
  await page.waitForSelector(visible('settings'));
  await page.click('#auto');
  ok(await page.isChecked('#auto'), 'auto mode back on');
  await page.click('#settings-done');
  const n0 = stub.meetings.size;
  await detector({ type: 'started', app: 'Phone Link', platform: 'phone-link' }); // what main sends in auto mode
  await page.waitForSelector(visible('live'));
  const auto1 = [...stub.meetings.values()].at(-1);
  ok(stub.meetings.size === n0 + 1 && auto1.request.platform === 'phone-link' && auto1.request.auto_started === true && !auto1.request.company,
    `Phone Link took the mic -> call started with no form (POST ${JSON.stringify(auto1.request)})`);
  ok(await page.textContent('#bar-name') === 'Phone Link call' && await page.textContent('#caller-plat') === 'Phone Link' && await page.textContent('#caller-name') === "Who's this?",
    '"Who\'s this?" chip and header show the platform');
  await shot(page, '14-auto-live-whos-this');
  await page.click('#caller-btn');
  await page.fill('#cf-company', 'Fabrikam Steel'); await page.fill('#cf-name', 'Vikram Rao'); await page.fill('#cf-title', 'CIO');
  await shot(page, '14b-auto-caller-form');
  await page.click('#cf-save');
  await page.waitForSelector('#caller-form', { state: 'hidden' });
  ok(auto1.patches.at(-1)?.company === 'Fabrikam Steel' && auto1.patches.at(-1)?.contact_name === 'Vikram Rao' && auto1.patches.at(-1)?.contact_title === 'CIO'
    && await page.textContent('#bar-name') === 'Fabrikam Steel' && (await page.textContent('#caller-sub')).includes('Vikram Rao'), 'company + contact saved with PATCH; header and chip update');
  await onOverlay(app, (w, x) => w.webContents.send('capture', { type: 'health', customerSilent: x }), true);
  await page.waitForSelector('#health:not([hidden])');
  ok((await page.textContent('#health')).includes('turn on “Use your PC for call audio”'), 'Phone Link call with silent call audio -> banner points at Phone Link\'s audio setting');
  await shot(page, '14c-auto-phone-link-health');
  await page.click('#health-x');
  await detector({ type: 'releasing', app: 'Phone Link', platform: 'phone-link', graceMs: 15000 });
  await page.waitForSelector('#auto-end:not([hidden])');
  ok(/Ending in 1[45] s/.test(await page.textContent('#auto-end')) && await page.isHidden('#call-ended'), 'Phone Link let go -> "Ending in 15 s" countdown, no prompt');
  await shot(page, '14d-auto-ending-countdown');
  await page.click('#ae-keep');
  ok(await page.isHidden('#auto-end'), 'Keep listening cancels the countdown');
  await detector({ type: 'released', app: 'Phone Link', platform: 'phone-link', autoEndMs: 300000 });
  await page.waitForTimeout(1200);
  ok(await page.isHidden('#call-ended') && await page.isHidden('#auto-end') && await page.isVisible(visible('live')), 'after Keep listening: no prompt, no countdown, still live');
  await detector({ type: 'back', app: 'Phone Link', platform: 'phone-link' });
  await detector({ type: 'releasing', app: 'Phone Link', platform: 'phone-link', graceMs: 3000 });
  await page.waitForSelector(visible('ended'), { timeout: 30000 });
  ok(auto1.status === 'ended' && await page.textContent('#ended-company') === 'Fabrikam Steel', 'next time it lets go the countdown runs out -> ended and summarised, named company kept');
  await detector({ type: 'started', app: 'Teams', platform: 'teams' }); // a second auto call nobody names
  await page.waitForSelector(visible('live'));
  await detector({ type: 'releasing', app: 'Teams', platform: 'teams', graceMs: 2000 });
  await page.waitForSelector(visible('ended'), { timeout: 30000 });
  ok(await page.textContent('#ended-company') === 'Contoso Life' && (await page.textContent('#ended-meta')).includes('Company detected from the call'),
    'unnamed auto call: Ended shows the company detected from the call');
  await shot(page, '14e-auto-ended-detected');
} finally {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), clipboardBefore).catch(() => {});
  await app.close().catch(() => {});
  await stub.close();
}

// The bearer token must never be on disk in clear text, anywhere in the profile (settings, localStorage, caches).
const leaks = fs.readdirSync(profile, { recursive: true }).map(f => path.join(profile, f))
  .filter(f => fs.statSync(f).isFile() && fs.statSync(f).size < 50e6 && fs.readFileSync(f).includes('stub-token'));
ok(leaks.length === 0 && fs.existsSync(path.join(profile, 'session.bin')), `token stored only DPAPI-encrypted (${leaks.join(', ') || 'no plain copies'})`);
const mainLog = fs.readFileSync(path.join(profile, 'main.log'), 'utf8');
ok(/AEC3 ready/.test(mainLog) && /capture on: echo=aec3/.test(mainLog) && /\[overlay\] call started/.test(mainLog) && /invisible mode off/.test(mainLog),
  'main.log has main, capture and overlay lines (AEC3 ready, echo=aec3, call started)');
ok(!/twelve hundred|remote access works|budget set aside|Citrix|RBI/i.test(mainLog), 'main.log holds no transcript or card text');
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true });
console.log(`ui.check: ${n} assertions passed`);
