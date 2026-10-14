// Run: node desktop/test/echo.check.mjs - AEC3 (real WASM, in node) removes a simulated speaker echo; the echo gate
// keeps echo out of the rep VAD but lets the rep through (alone and over the customer); the call-health warning.
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { EchoGate, CallHealth, HEALTH_PHONE_LINK, Vad, rmsDb, RATE, FRAME } from '../renderer/audio-core.js';
import { loadAec3, createAec } from '../renderer/aec.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok ${n} - ${m}`); };
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;

// Speech-like test signal: noise shaped by a 4 Hz syllable envelope, gaps between "phrases".
function talker(seconds, level, phrases) {
  const x = new Float32Array(Math.round(seconds * RATE));
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE, on = phrases.some(([a, b]) => t >= a && t < b);
    lp += 0.3 * (rnd() - lp); // gentle low-pass so it isn't white
    x[i] = on ? level * lp * (0.65 + 0.35 * Math.sin(2 * Math.PI * 4 * t)) : 0;
  }
  return x;
}
// What the laptop mic hears of the speakers: 45 ms late, quieter, with a little room reverb.
function echoOf(far, gain = 0.25) {
  const y = new Float32Array(far.length), taps = [[720, 1], [1100, 0.35], [1700, 0.15]];
  for (let i = 0; i < far.length; i++) for (const [d, g] of taps) if (i >= d) y[i] += gain * g * far[i - d];
  return y;
}
const mix = (...xs) => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0) + rnd() * 0.0005); // + mic self-noise
const frames = (x, f) => { for (let i = 0; i + FRAME <= x.length; i += FRAME) f(x.subarray(i, i + FRAME), i / FRAME); };
const seg = (x, a, b) => x.subarray(Math.round(a * RATE), Math.round(b * RATE));

// ---- AEC3 in WebAssembly, wired exactly as the capture window uses it
const require = createRequire(import.meta.url);
const libPath = require.resolve('@ennuicastr/webrtcaec3.js');
const lib = await loadAec3(require(libPath), fs.readFileSync(libPath.replace(/\.js$/, '.wasm')));
const customer = talker(12, 0.3, [[0.5, 4.5], [5.5, 9], [10, 11.5]]);
const rep = talker(12, 0.12, [[10.3, 11.4]]); // the rep talks over the customer's last phrase (10-11.5 s)
const echo = echoOf(customer), mic = mix(echo, rep);
const aec = createAec(lib), clean = new Float32Array(mic.length);
frames(mic, (f, k) => clean.set(aec.process(f, customer.subarray(k * FRAME, (k + 1) * FRAME)), k * FRAME));
const erle = rmsDb(seg(mic, 6, 9)) - rmsDb(seg(clean, 6, 9));
ok(erle > 15, `AEC3 removes the speaker echo once converged: ${erle.toFixed(1)} dB (echo-only stretch 6-9 s)`);
const keep = rmsDb(seg(clean, 10.5, 11.2)) - rmsDb(seg(rep, 10.5, 11.2));
ok(keep > -8, `the rep's own voice survives AEC3 during double talk (${keep.toFixed(1)} dB vs the clean rep)`);
let threw = false;
try { await loadAec3(require(libPath), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 9])); } catch { threw = true; }
ok(threw, 'a broken .wasm rejects (so the app falls back to the browser AEC instead of hanging)');
aec.free();

// ---- echo gate. Customer 0.5-4.5, 5.5-9, 10-11.5 s; rep 10.3-11.4 s (over the customer).
function gated(micSig, farSig, opts) { // opts === null: no gate at all
  const gate = opts === null ? null : new EchoGate(opts), vad = new Vad(), ups = [], open = [];
  frames(micSig, (f, k) => {
    const allow = gate ? gate.push(f, farSig.subarray(k * FRAME, (k + 1) * FRAME)) : true;
    open.push(allow);
    ups.push(...vad.push(f, allow));
  });
  ups.push(...vad.flush());
  return { ups, open, gate };
}
const at = u => u.startMs / 1000, show = ups => ups.map(u => `${at(u).toFixed(2)}s+${u.durationMs}`).join(', ') || 'none';
// Worst case first: AEC3 unavailable, so the gate sees the raw echo (the customer's words at ~ -11 dB in the mic).
const echoOnly = mix(echo);
const raw = gated(echoOnly, customer, null);
ok(raw.ups.length >= 3, `no AEC, no gate: the rep VAD uploads the echo (${show(raw.ups)})`);
const rawGated = gated(echoOnly, customer);
ok(rawGated.ups.length === 0, `no AEC, gate on: nothing uploaded from echo alone (${show(rawGated.ups)})`);
ok(rawGated.gate.coupling > 0.15 && rawGated.gate.coupling < 0.5, `coupling learned from customer-only audio: ${rawGated.gate.coupling.toFixed(3)} (echo path gain 0.25 + reverb)`);
// The real pipeline: AEC3-cleaned mic through the gate. Echo stays out, the rep gets through while talking over the customer.
const g = gated(clean, customer);
ok(g.ups.length === 1 && at(g.ups[0]) > 10 && at(g.ups[0]) < 10.6 && g.ups[0].durationMs >= 1200,
  `AEC3 + gate: exactly the rep's one utterance, nothing from the echo (${show(g.ups)})`);
const firstOpen = g.open.findIndex((v, k) => v && k * 0.02 > 10.05) * 0.02; // the call is playing from 10.0 s
ok(firstOpen >= 10.5 && firstOpen < 10.75, `during double talk the gate opens ~240 ms into the rep's speech (${firstOpen.toFixed(2)} s, rep starts 10.30 s)`);

// Rep alone, nothing playing: no proof needed, the VAD decides as before.
const solo = talker(4, 0.12, [[0.5, 2.5]]);
const s = gated(mix(solo), new Float32Array(solo.length));
ok(s.ups.length === 1 && Math.abs(at(s.ups[0]) - 0.2) < 0.05, 'rep alone (call silent) passes untouched, pre-roll included');
// Muted mic (exact zeros) while the customer talks must not teach the gate that the speakers are silent.
const mg = new EchoGate();
frames(customer, f => mg.push(new Float32Array(FRAME), f));
ok(mg.coupling === 1, 'a muted mic leaves the coupling alone');

// ---- "Can't hear the call" warning
const h = new CallHealth(), flips = [];
for (let k = 0; k < 1500; k++) { const r = h.push(k % 2 ? -30 : -70, -180); if (r !== null) flips.push([k * 20, r]); } // 30 s, rep talking half the time, call silent
ok(flips.length === 1 && flips[0][0] === 19980 && flips[0][1] === true, `warns 20 s into a call that is silent while the mic hears speech (${JSON.stringify(flips)})`);
ok(h.push(-30, -25) === false, 'clears as soon as call audio is heard');
const quiet = new CallHealth();
let warned = false;
for (let k = 0; k < 1500; k++) warned ||= quiet.push(-70, -180) === true;
ok(!warned, 'no warning when nobody is talking at all');
const phone = new CallHealth(HEALTH_PHONE_LINK);
let at10 = null;
for (let k = 0; k < 1000 && at10 === null; k++) if (phone.push(-70, -180) === true) at10 = (k + 1) * 20;
ok(at10 === 10000, `Phone Link call: warns after 10 s of silent call audio even with nobody talking (${at10} ms)`);

console.log(`echo.check: ${n} assertions passed`);
