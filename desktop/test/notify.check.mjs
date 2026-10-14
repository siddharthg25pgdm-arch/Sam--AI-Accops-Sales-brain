// Run: node desktop/test/notify.check.mjs - meeting-app watcher end to end: a process named Zoom.exe starts ->
// one native notification (not repeated on the next 20 s poll) -> clicking it opens Start call.
// The fake Zoom is a copy of ping.exe; takes about a minute because the watcher polls every 20 s.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startStub } from '../scripts/stub-server.mjs';
import { launch, pointAt, signIn, visible, tempDir } from './harness.mjs';

const stub = await startStub(), profile = tempDir('profile'), work = tempDir('zoom');
const fakeZoom = path.join(work, 'Zoom.exe');
fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE'), fakeZoom);
const { app, page } = await launch({ profile });
let zoom;
const zoomNotes = () => app.evaluate(() => globalThis.__notes.filter(n => n.body.includes('Zoom')).map(n => `${n.title} | ${n.body}`));
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

  zoom = spawn(fakeZoom, ['-n', '90', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
  let seen = [];
  for (let i = 0; i < 30 && !seen.length; i++) { await page.waitForTimeout(1000); seen = await zoomNotes(); }
  assert.deepEqual(seen, ['Meeting app running — start SAM Live? | Zoom is open. Click to set up the call.'], `notification on Zoom start: ${seen}`);
  console.log(`  ok - notified once Zoom.exe appeared: "${seen[0]}"`);
  await page.waitForTimeout(21000);
  assert.equal((await zoomNotes()).length, 1, 'not repeated while Zoom keeps running');
  console.log('  ok - not repeated on the next poll');
  await app.evaluate(() => globalThis.__notes.find(n => n.body.includes('Zoom')).emit('click'));
  await page.waitForSelector(visible('start'), { timeout: 5000 });
  console.log('  ok - clicking it opens Start call');
} finally {
  zoom?.kill();
  await app.close().catch(() => {});
  await stub.close();
}
await new Promise(r => setTimeout(r, 500));
fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
console.log('notify.check: passed');
