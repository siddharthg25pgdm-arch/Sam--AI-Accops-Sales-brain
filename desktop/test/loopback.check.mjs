// Run: node desktop/test/loopback.check.mjs - REAL Windows system-audio loopback, no fake devices. Starts a call
// against the stub, mutes the mic, plays SAPI speech out loud through the default output device, and checks the stub
// received one customer-channel WAV per phrase whose length matches the phrase (voiced length + 300 ms pre-roll + 300 ms tail).
import assert from 'node:assert';
import fs from 'node:fs';
import { startStub } from '../scripts/stub-server.mjs';
import { synthesize, playThroughSpeakers } from './speech.mjs';
import { launch, pointAt, signIn, shot, visible, tempDir } from './harness.mjs';

const PHRASES = [
  'We have about four hundred users on Citrix today.',
  'Our compliance team needs every session recorded and the data kept in India.',
  'Could you send us pricing for twelve hundred concurrent users before the end of this month, so our CIO can review it with finance?',
];
const GAP_MS = 2000, PAD_MS = 600, TOLERANCE_MS = 700;
const stub = await startStub(), work = tempDir('loop'), profile = tempDir('profile');
const said = synthesize(PHRASES, work);
const { app, page } = await launch({ profile });
let customer = [], rep = [];
try {
  await page.waitForSelector(visible('signin'));
  await pointAt(page, stub.url);
  await signIn(page);
  await page.waitForSelector(visible('start'));
  const hint = await page.textContent('#audio-hint');
  assert.ok(!/Call audio unavailable/.test(hint), `system audio capture failed: ${hint}`);
  await page.fill('#company', 'Loopback test');
  await page.click('#start-btn');
  await page.waitForSelector(visible('live'));
  await page.click('#mute'); // the room mic would also hear the speakers; this test is about the loopback channel
  await page.waitForTimeout(1500);
  const callT0 = Date.parse([...stub.meetings.values()][0].started_at), playT0 = Date.now();
  await playThroughSpeakers(said.map(s => s.file), GAP_MS);
  await page.waitForTimeout(3000); // 700 ms hang + upload
  await page.click('#transcript summary');
  await shot(page, '12-loopback-live');
  customer = stub.uploads.filter(u => u.channel === 'customer' && u.status === 200).sort((a, b) => a.t_ms - b.t_ms);
  rep = stub.uploads.filter(u => u.channel === 'rep');
  console.log(`playback started ~${playT0 - callT0} ms after the call started`);
} finally {
  await app.close().catch(() => {});
  await stub.close();
}

console.log('phrase  wav_ms  voiced_ms  expected_upload_ms | upload t_ms  duration_ms  diff');
said.forEach((s, i) => {
  const u = customer[i], want = s.voicedMs + PAD_MS;
  console.log(`  ${i + 1}     ${String(s.ms).padStart(5)}  ${String(s.voicedMs).padStart(8)}  ${String(want).padStart(17)}  | ${u ? `${String(u.t_ms).padStart(10)}  ${String(u.duration_ms).padStart(11)}  ${u.duration_ms - want > 0 ? '+' : ''}${u.duration_ms - want}` : 'missing'}`);
});
console.log(`customer uploads: ${customer.length}, rep uploads (mic muted): ${rep.length}`);
assert.ok(customer.length === PHRASES.length, `expected ${PHRASES.length} customer-channel uploads, got ${customer.length}`);
said.forEach((s, i) => assert.ok(Math.abs(customer[i].duration_ms - (s.voicedMs + PAD_MS)) <= TOLERANCE_MS, `phrase ${i + 1} length mismatch`));
assert.ok(customer.every(u => u.type === 'audio/wav' && Math.abs(u.wav_ms - u.duration_ms) <= 1), 'uploads are WAVs of the stated length');
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true });
console.log(`loopback.check: passed - ${customer.length} customer-channel utterances captured from real system audio`);
