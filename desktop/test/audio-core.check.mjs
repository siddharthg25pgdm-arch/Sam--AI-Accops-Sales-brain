// Run: node desktop/test/audio-core.check.mjs - VAD splitting, length limits, WAV bytes, resampler.
import assert from 'node:assert';
import { Vad, encodeWav, Resampler, rmsDb, RATE } from '../renderer/audio-core.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b} +/- ${tol}`);

// Deterministic noise (LCG) at about -55 dBFS plus 440 Hz tone bursts at about -13.5 dBFS.
let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
const parts = [];
const noise = s => parts.push(Float32Array.from({ length: Math.round(s * RATE) }, () => rnd() * 0.003));
const tone = s => parts.push(Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / RATE) + rnd() * 0.003));
noise(1.0); tone(1.0);                       // A: one clean utterance
noise(1.5); tone(0.3);                       // blip: under minSpeech, dropped
noise(1.5); tone(0.5); noise(0.3); tone(0.5); // B: a 300 ms gap is not the end of a sentence
noise(1.5); tone(20);                        // C: cut at 15 s, remainder continues
noise(2.0);
const signal = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
parts.reduce((o, p) => (signal.set(p, o), o + p.length), 0);

const vad = new Vad();
const got = [];
for (let i = 0; i < signal.length; i += 1234) got.push(...vad.push(signal.subarray(i, i + 1234))); // odd chunk size on purpose
got.push(...vad.flush());

ok(got.length === 4, `4 utterances (A, B, C1, C2), got ${got.length}: ${got.map(u => `${u.startMs}+${u.durationMs}`).join(', ')}`);
const [A, B, C1, C2] = got;
near(A.startMs, 700, 40, 'A starts 300 ms pre-roll before the onset');
near(A.durationMs, 1600, 60, 'A = pre-roll + 1.0 s + 300 ms tail');
near(B.startMs, 5000, 40, 'B starts at its first burst minus pre-roll');
near(B.durationMs, 1900, 60, 'B keeps both bursts and the 300 ms gap');
near(B.speechMs, 1000, 60, 'B speech excludes the gap');
ok(C1.durationMs === 15000, `C1 is cut at exactly 15 s, got ${C1.durationMs}`);
near(C1.startMs, 7800, 40, 'C1 start');
near(C2.startMs, C1.startMs + 15000, 20, 'C2 picks up exactly where C1 was cut (no repeated audio)');
near(C2.durationMs, 5600, 60, 'C2 = rest of the tone + tail, no pre-roll');
ok(got.every(u => u.samples.length === u.durationMs * RATE / 1000), 'sample count matches duration');
ok(got.every(u => rmsDb(u.samples) > -20), 'utterances contain the tone, not the noise');

// Max length is a parameter, and flush() returns a trailing in-flight utterance.
const v2 = new Vad({ maxMs: 2000 });
const pieces = [...v2.push(signal.subarray(Math.round(6.6 * RATE), Math.round(13.1 * RATE))), ...v2.flush()]; // 1.5 s noise, 5 s tone, stream ends mid-tone
ok(pieces.map(p => p.durationMs).join() === '2000,2000,1300', `maxMs 2000 cuts 5 s of tone into 2 + 2 + 1.3 (flushed), got ${pieces.map(p => p.durationMs)}`);
ok(new Vad().flush().length === 0, 'flush on an idle VAD is empty');

// Pure silence (loopback with nothing playing) never opens the gate.
ok(new Vad().push(new Float32Array(RATE * 3)).length === 0 && new Vad().flush().length === 0, 'digital silence -> nothing');

// WAV: 44-byte header + 2 bytes per sample, little-endian PCM16, clamped.
const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5, 2]));
const dv = new DataView(wav.buffer), tag = o => String.fromCharCode(...wav.subarray(o, o + 4));
ok(wav.length === 44 + 10, `byte length ${wav.length}`);
ok(tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data', 'chunk tags');
ok(dv.getUint32(4, true) === wav.length - 8, 'RIFF size');
ok(dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 1 && dv.getUint32(24, true) === 16000, 'PCM, mono, 16 kHz');
ok(dv.getUint32(28, true) === 32000 && dv.getUint16(32, true) === 2 && dv.getUint16(34, true) === 16, 'byte rate, block align, 16-bit');
ok(dv.getUint32(40, true) === 10, 'data size');
ok([0, 1, 2, 3, 4].map(i => dv.getInt16(44 + i * 2, true)).join() === '0,32767,-32768,16383,32767', 'sample values, clamped');
const big = encodeWav(A.samples);
ok(big.length === 44 + A.samples.length * 2 && new DataView(big.buffer).getUint32(40, true) === A.samples.length * 2, 'utterance WAV size');

// Resampler fallback: 48 kHz and 44.1 kHz in arbitrary chunks -> 16 kHz, level preserved.
for (const inRate of [48000, 44100]) {
  const src = Float32Array.from({ length: inRate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / inRate));
  const rs = new Resampler(inRate), outs = [];
  for (let i = 0; i < src.length; i += 1000) outs.push(rs.push(src.subarray(i, i + 1000)));
  const out = new Float32Array(outs.reduce((s, o) => s + o.length, 0)); outs.reduce((o, x) => (out.set(x, o), o + x.length), 0);
  near(out.length, 16000, 1, `${inRate} -> 16000 samples`);
  near(rmsDb(out), rmsDb(src), 0.3, `${inRate} level kept (dB)`);
}
ok(new Resampler(16000).push(signal.subarray(0, 100)).length === 100, '16 kHz passes straight through');

console.log(`audio-core.check: ${n} assertions passed`);
