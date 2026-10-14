// Run: node desktop/test/notify.check.mjs - call detection end to end through main. Manual mode: the mic-consent
// registry says Zoom took the mic -> one native notification "Call started in Zoom. Start SAM Live?" -> clicking it
// opens Start call; during a live call Teams lets go of the mic -> after the 15 s grace the overlay asks "Call ended?".
// Auto mode: Phone Link takes the mic -> the call starts by itself; Phone Link lets go -> 15 s countdown -> ended.
// The registry is a file (SAM_LIVE_FAKE_REG) in `reg query` format, so no real call is needed. ~1.5 minutes.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { startStub } from '../scripts/stub-server.mjs';
import { launch, pointAt, signIn, visible, tempDir } from './harness.mjs';

const H = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const entry = (name, inUse) => `${H}\\${name}\r\n    Value    REG_SZ    Allow\r\n    LastUsedTimeStart    REG_QWORD    0x1dd2a1b31ca0695\r\n    LastUsedTimeStop    REG_QWORD    ${inUse ? '0x0' : '0x1dd2a1c7826da51'}\r\n`;
const stub = await startStub(), profile = tempDir('profile'), work = tempDir('reg'), reg = path.join(work, 'mic.txt');
const setMic = (...using) => fs.writeFileSync(reg, [`${H}\r\n    Value    REG_SZ    Allow\r\n`,
  entry('MSTeams_8wekyb3d8bbwe', using.includes('Teams')), entry('Microsoft.YourPhone_8wekyb3d8bbwe', using.includes('Phone Link')),
  entry('NonPackaged\\C:#Users#rep#AppData#Roaming#Zoom#bin#Zoom.exe', using.includes('Zoom'))].join('\r\n'));
setMic();
process.env.SAM_LIVE_FAKE_REG = reg;
const { app, page } = await launch({ profile });
const notes = () => app.evaluate(() => globalThis.__notes.map(n => `${n.title} | ${n.body}`));
try {
  await app.evaluate(({ Notification }) => { // spy on what main shows; the real toast still goes out
    globalThis.__notes = [];
    const show = Notification.prototype.show;
    Notification.prototype.show = function () { globalThis.__notes.push(this); return show.call(this); };
  });
  await page.waitForSelector(visible('signin'));
  await pointAt(page, stub.url);
  await signIn(page);
  await page.waitForSelector(visible('start'));
  await page.click('#btn-settings');
  await page.waitForSelector(visible('settings'));
  await page.click('#auto'); // manual mode first
  assert.ok(!(await page.isChecked('#auto')), 'auto mode off');

  setMic('Zoom');
  let seen = [];
  for (let i = 0; i < 20 && !seen.length; i++) { await page.waitForTimeout(500); seen = await notes(); }
  assert.deepEqual(seen, ['Call started in Zoom. Start SAM Live? | Click to set up the call.'], `notification when Zoom takes the mic: ${seen}`);
  console.log(`  ok - notified once Zoom took the mic: "${seen[0]}"`);
  await page.waitForTimeout(7000);
  assert.equal((await notes()).length, 1, 'not repeated while Zoom keeps the mic');
  console.log('  ok - not repeated on the next polls');
  await app.evaluate(() => globalThis.__notes[0].emit('click'));
  await page.waitForSelector(visible('start'), { timeout: 5000 });
  console.log('  ok - clicking it opens Start call');

  setMic('Teams');
  await page.fill('#company', 'Detector test');
  await page.click('#start-btn');
  await page.waitForSelector(visible('live'));
  await page.waitForTimeout(4000); // a poll sees Teams on the mic during the live call
  assert.equal((await notes()).length, 1, 'no "call started" notification while a call is live');
  setMic();
  const t0 = Date.now();
  await page.waitForSelector('#call-ended:not([hidden])', { timeout: 30000 });
  const after = (Date.now() - t0) / 1000;
  assert.ok(after >= 14, `prompt only after the 15 s grace (${after.toFixed(1)} s)`);
  assert.ok((await page.textContent('#call-ended')).includes('Teams has let go of the microphone'), 'prompt names the app');
  console.log(`  ok - Teams left the mic -> "Call ended?" after ${after.toFixed(1)} s`);
  setMic('Teams');
  await page.waitForSelector('#call-ended', { state: 'hidden', timeout: 8000 });
  console.log('  ok - Teams back on the mic -> prompt cleared');
  await page.click('#end'); await page.click('#end');
  await page.waitForSelector(visible('ended'), { timeout: 30000 });

  // ---- auto mode
  setMic();
  await page.click('#new-call');
  await page.click('#btn-settings');
  await page.waitForSelector(visible('settings'));
  await page.click('#auto');
  await page.click('#settings-done');
  await page.waitForTimeout(4000); // a poll with nobody on the mic
  const before = stub.meetings.size;
  setMic('Phone Link');
  await page.waitForSelector(visible('live'), { timeout: 10000 });
  const m = [...stub.meetings.values()].at(-1);
  assert.ok(stub.meetings.size === before + 1 && m.request.platform === 'phone-link' && m.request.auto_started === true, `auto-started with ${JSON.stringify(m.request)}`);
  assert.equal((await notes()).length, 1, 'no notification in auto mode');
  console.log('  ok - auto mode: Phone Link took the mic -> call started by itself (platform phone-link), no notification');
  await page.waitForTimeout(3500);
  setMic();
  await page.waitForSelector('#auto-end:not([hidden])', { timeout: 8000 });
  const t1 = Date.now();
  await page.waitForSelector(visible('ended'), { timeout: 30000 });
  const took = (Date.now() - t1) / 1000;
  assert.ok(m.status === 'ended' && took >= 12, `ended by itself after the countdown (${took.toFixed(1)} s)`);
  console.log(`  ok - Phone Link let go -> countdown -> ended and summarised by itself ${took.toFixed(1)} s later`);
} finally {
  await app.close().catch(() => {});
  await stub.close();
}
await new Promise(r => setTimeout(r, 500));
fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
console.log('notify.check: passed');
