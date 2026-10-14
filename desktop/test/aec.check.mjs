// Run: node desktop/test/aec.check.mjs - REAL acoustic echo test, no fake devices. A customer is played OUT LOUD
// through the speakers with the rep's mic UNMUTED, so the laptop mic hears the speakers exactly as on a call without a
// headset. Nobody should talk near the laptop while it runs (~2.5 min). The same script runs once per echo mode:
//   browser       Chromium's AEC/NS/AGC only, no gate (the pipeline before AEC3; Chromium can't see what SAPI plays)
//   browser+gate  what the app falls back to if the AEC3 WebAssembly fails to load
//   aec3          AEC3 with the loopback as far end + echo gate (the default)
// and counts uploads per channel at the stub. Pass: the customer channel gets every phrase in every mode, and the rep
// channel gets at most 1 echo clip with aec3 while the browser-only baseline gets several.
// SAM_LIVE_AEC_MODES=aec3,browser limits the modes.
import assert from 'node:assert';
import fs from 'node:fs';
import { startStub } from '../scripts/stub-server.mjs';
import { synthesize, playThroughSpeakers } from './speech.mjs';
import { launch, pointAt, signIn, shot, visible, tempDir } from './harness.mjs';

const PHRASES = [
  'We have about four hundred users on Citrix today, mostly in our branches.',
  'Our compliance team needs every session recorded and the data kept in India.',
  'The renewal is in March, and the licence cost went up a lot this year.',
  'Contractors use their own laptops, so we cannot install heavy agents on them.',
  'Our CIO signs off, but the infrastructure team will run the evaluation.',
  'Could you send pricing for twelve hundred users before the end of this month?',
];
const MODES = (process.env.SAM_LIVE_AEC_MODES || 'browser,browser+gate,aec3').split(',');
const work = tempDir('aec'), said = synthesize(PHRASES, work);
const results = [];

for (const mode of MODES) {
  const stub = await startStub(), profile = tempDir('profile');
  process.env.SAM_LIVE_ECHO = mode;
  const { app, page, cap } = await launch({ profile });
  try {
    await page.waitForSelector(visible('signin'));
    await pointAt(page, stub.url);
    await signIn(page);
    await page.waitForSelector(visible('start'));
    const hint = await page.textContent('#audio-hint');
    assert.ok(!/unavailable/.test(hint), `audio capture failed: ${hint}`);
    await page.fill('#company', `Echo test (${mode})`);
    await page.click('#start-btn');
    await page.waitForSelector(visible('live'));
    const info = await cap.evaluate(() => samCapture.info());
    assert.equal(info.mode, mode, `capture runs in ${mode} mode`);
    await page.waitForTimeout(1500);
    // peak of the rep meter (cleaned mic level) while the customer plays: how much of the speakers is left in the mic
    await page.evaluate(() => { window.__peak = []; window.__t = setInterval(() => window.__peak.push(Number(/scaleX\(([\d.]+)/.exec(document.getElementById('mlvl-rep').style.transform)?.[1] || 0)), 100); });
    await playThroughSpeakers(said.map(s => s.file), 2000);
    await page.waitForTimeout(3000); // 700 ms hang + upload
    const levels = await page.evaluate(() => { clearInterval(window.__t); return window.__peak; });
    const coupling = (await cap.evaluate(() => samCapture.info())).coupling;
    if (mode === 'aec3') { await page.click('#transcript summary'); await shot(page, '13-aec-live'); }
    await page.click('#end'); await page.click('#end'); // flushes the VADs
    await page.waitForSelector(visible('ended'), { timeout: 60000 });
    const ok200 = ch => stub.uploads.filter(u => u.channel === ch && u.status === 200);
    const sorted = [...levels].sort((a, b) => a - b), pct = p => sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
    // meter scale 0..1 = -60..-15 dBFS
    const db = v => (v * 45 - 60).toFixed(0);
    results.push({ mode, customer: ok200('customer').length, custMs: ok200('customer').map(u => u.duration_ms), rep: ok200('rep').length, repMs: ok200('rep').map(u => u.duration_ms),
      micP90: `${db(pct(0.9))} dBFS`, micMax: `${db(pct(1))} dBFS`, coupling: coupling == null ? 'n/a' : coupling.toFixed(3) });
  } finally {
    await app.close().catch(() => {});
    await stub.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  await new Promise(r => setTimeout(r, 1500));
}
fs.rmSync(work, { recursive: true, force: true });

console.log(`\n${PHRASES.length} customer phrases played through the speakers, mic unmuted (rep mic level = what is left after echo processing; -60 = floor)`);
console.log('mode           customer  rep  rep clip ms             mic p90   mic max   learned coupling');
for (const r of results) console.log(`${r.mode.padEnd(14)} ${String(r.customer).padStart(8)}  ${String(r.rep).padStart(3)}  ${(r.repMs.join(',') || '-').padEnd(22)}  ${r.micP90.padStart(8)}  ${r.micMax.padStart(8)}   ${r.coupling}`);
for (const r of results) console.log(`  ${r.mode} customer clips (ms): ${r.custMs.join(', ')}`);
const by = Object.fromEntries(results.map(r => [r.mode, r]));
// >= : a long pause inside a phrase, or a Windows sound during the run, can add a customer clip; none may be missing
for (const r of results) assert.ok(r.customer >= PHRASES.length, `${r.mode}: customer channel should get all ${PHRASES.length} phrases, got ${r.customer}`);
if (by.browser) assert.ok(by.browser.rep >= 2, `the browser-only baseline should upload the echo several times; got ${by.browser.rep}. If 0, the mic did not hear the speakers (muted, headset, or very low volume) and this PC can't run this test.`);
if (by.aec3) assert.ok(by.aec3.rep <= 1, `aec3 + gate should let at most 1 echo clip through, got ${by.aec3.rep}`);
console.log(`aec.check: passed - rep-channel echo uploads ${MODES.map(m => `${m} ${by[m].rep}`).join(', ')}`);
