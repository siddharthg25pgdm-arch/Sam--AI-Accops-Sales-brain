// Hidden capture window. It owns the mic and the system loopback for the whole app session, so hiding, minimising or
// reloading the overlay never stops a call. Every 20 ms:
//   mic + loopback (one AudioContext, one worklet: same render quantum, so they are aligned)
//   -> AEC3 with the loopback as far end -> echo gate -> rep VAD      loopback -> customer VAD
//   -> 16 kHz WAV per utterance -> overlay (which owns the upload queue)
// Commands come from the overlay through main (run / mute / call); events go back the same way.
import { Vad, EchoGate, CallHealth, HEALTH, HEALTH_PHONE_LINK, encodeWav, rmsDb, Resampler, RATE, FRAME } from './audio-core.js';
import { loadAec3, createAec } from './aec.js';

// aec3 (default) | browser+gate (what a failed AEC3 load falls back to) | browser (Chromium AEC only, no gate:
// the pre-AEC3 pipeline, kept so tests can measure the difference). Set by main from SAM_LIVE_ECHO.
const MODES = ['aec3', 'browser+gate', 'browser'];
const MODE = MODES.find(m => m === new URLSearchParams(location.search).get('echo')) ?? 'aec3';
const RECOVER = { tries: 5, gapMs: 500 }; // mic hot-swap: re-acquire up to 5 times, 500 ms apart

const post = msg => sam.post(msg);
const log = (level, msg) => sam.log(level, msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errInfo = e => e ? { name: e.name || 'Error', message: String(e.message || e) } : null;
const mics = async () => (await navigator.mediaDevices.enumerateDevices())
  .filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications').map(d => ({ deviceId: d.deviceId, label: d.label }));

let lib, libP = null;
function aec3() {
  libP ??= fetch('vendor/webrtcaec3-0.3.0.wasm').then(r => r.arrayBuffer()).then(w => loadAec3(globalThis.WebRtcAec3, w)).then(
    l => { log('info', 'AEC3 ready'); return (lib = l); },
    e => { log('warn', `AEC3 unavailable (${e?.message || e}); falling back to the browser's echo cancellation`); return null; });
  return libP;
}

let cur = null, call = null, muted = false, chain = Promise.resolve();
sam.onCmd(m => { chain = chain.then(() => handle(m)).catch(e => log('error', `capture ${m?.cmd}: ${e?.message || e}`)); });
post({ type: 'ready' });

async function handle(m) {
  if (m.cmd === 'run') {
    const micId = m.micId || '';
    if (m.on && cur && cur.micId === micId && !cur.errors.rep && !cur.errors.customer) return post(state());
    await stop();
    if (m.on) await start(micId);
    post(state());
  } else if (m.cmd === 'mute') {
    muted = !!m.on;
    cur?.mic?.getAudioTracks().forEach(t => { t.enabled = !muted; }); // a disabled track feeds silence
  } else if (m.cmd === 'call') {
    if (m.on && !call) call = { t0: Date.now(), rep: new Vad(), customer: new Vad(), health: new CallHealth(), clips: { rep: 0, customer: 0 } };
    if (m.on) call.health.k = { ...HEALTH, ...(m.platform === 'phone-link' ? HEALTH_PHONE_LINK : {}) }; // platform can arrive mid-call
    if (!m.on) { endCall(); post({ type: 'flushed' }); }
  }
}

function state() {
  return { type: 'state', running: !!cur, echo: cur?.mode ?? null, mics: cur?.mics ?? [], micId: cur?.micId ?? '',
    errors: { rep: errInfo(cur?.errors.rep), customer: errInfo(cur?.errors.customer) } };
}

async function start(micId) {
  let ctx;
  try { ctx = new AudioContext({ sampleRate: RATE }); } catch { ctx = new AudioContext(); } // Resampler covers the fallback
  await ctx.audioWorklet.addModule('worklet.js');
  const node = new AudioWorkletNode(ctx, 'pair', { numberOfInputs: 2, numberOfOutputs: 0 });
  const r = { ctx, node, micId, mode: MODE, errors: {}, streams: [], mic: null, micSrc: null, aec: null, gate: null,
    rs: [new Resampler(ctx.sampleRate), new Resampler(ctx.sampleRate)], rest: [new Float32Array(0), new Float32Array(0)] };
  if (r.mode === 'aec3') {
    const l = await aec3();
    if (l) r.aec = createAec(l); else r.mode = 'browser+gate';
  }
  if (r.mode !== 'browser') r.gate = new EchoGate();

  try { await openMic(r); } catch (e) { r.errors.rep = e; }
  try {
    const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    for (const t of sys.getVideoTracks()) { t.stop(); sys.removeTrack(t); } // only the loopback audio is wanted
    if (!sys.getAudioTracks().length) throw new Error('No system audio track was granted.');
    ctx.createMediaStreamSource(sys).connect(node, 0, 1);
    r.streams.push(sys);
  } catch (e) { r.errors.customer = e; }

  node.port.onmessage = e => { if (cur === r) chunk(r, e.data); };
  await ctx.resume();
  r.mics = await mics();
  cur = r;
  navigator.mediaDevices.ondevicechange = () => deviceChange(r).catch(e => log('warn', `devicechange: ${e?.message}`));
  log('info', `capture on: echo=${r.mode} rate=${ctx.sampleRate} mic=${r.errors.rep ? `unavailable (${r.errors.rep.name})` : 'ok'} callAudio=${r.errors.customer ? `unavailable (${r.errors.customer.name || r.errors.customer.message})` : 'ok'}`);
}

async function openMic(r) {
  const dsp = r.mode !== 'aec3'; // AEC3 needs the raw mic: Chromium's own AEC/NS/AGC would fight it
  const s = await navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: r.micId ? { exact: r.micId } : undefined, channelCount: 1,
    echoCancellation: dsp, noiseSuppression: dsp, autoGainControl: dsp,
  } });
  if (r.stopped) { s.getTracks().forEach(t => t.stop()); return; }
  const t = s.getAudioTracks()[0];
  t.enabled = !muted;
  t.onended = () => recoverMic(r, 'the microphone stopped');
  r.micSrc?.disconnect();
  r.mic?.getTracks().forEach(x => { x.onended = null; x.stop(); });
  r.mic = s; r.micSrc = r.ctx.createMediaStreamSource(s); r.micSrc.connect(r.node, 0, 0);
}

// Headset unplugged, Bluetooth dropped, Windows default changed: get a mic back without touching the call.
async function recoverMic(r, why) {
  if (r.recovering || r.stopped) return;
  r.recovering = true;
  log('warn', `microphone lost (${why}); reconnecting`);
  post({ type: 'mic', state: 'recovering' });
  let last;
  for (let i = 1; i <= RECOVER.tries && !r.stopped; i++) {
    await sleep(RECOVER.gapMs);
    try {
      if (r.micId && !(await mics()).some(d => d.deviceId === r.micId)) r.micId = ''; // the chosen mic is gone: use the default
      await openMic(r);
      delete r.errors.rep;
      r.gate?.reset(); call?.health.reset(); // a new device has a new speaker->mic coupling (and maybe new call routing)
      r.recovering = false;
      r.mics = await mics();
      log('info', `microphone back (attempt ${i})`);
      post({ type: 'mic', state: 'ok' }); post(state());
      return;
    } catch (e) { last = e; }
  }
  r.recovering = false;
  if (r.stopped) return;
  r.errors.rep = last ?? new Error('microphone lost');
  r.micSrc?.disconnect(); r.micSrc = null; r.mic = null;
  log('error', `microphone could not be reopened (${last?.name || 'unknown'})`);
  post({ type: 'mic', state: 'lost' }); post(state());
}

async function deviceChange(r) {
  if (r.stopped || r.recovering) return;
  r.mics = await mics();
  const t = r.mic?.getAudioTracks()[0];
  if (!r.mic) return r.errors.rep ? recoverMic(r, 'a microphone appeared') : post(state());
  if (!t || t.readyState === 'ended') return recoverMic(r, 'device removed');
  if (!r.micId) {
    const def = (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'audioinput' && d.deviceId === 'default');
    const g = t.getSettings().groupId;
    if (def && g && def.groupId !== g) return recoverMic(r, 'Windows default microphone changed');
  }
  post(state());
}

function chunk(r, d) {
  const join = (a, b) => { if (!a.length) return b; const x = new Float32Array(a.length + b.length); x.set(a); x.set(b, a.length); return x; };
  const mic = join(r.rest[0], r.rs[0].push(d.mic)), loop = join(r.rest[1], r.rs[1].push(d.loop)); // same lengths by construction
  const whole = mic.length - mic.length % FRAME;
  r.rest = [mic.slice(whole), loop.slice(whole)];
  const clean = new Float32Array(whole);
  for (let i = 0; i < whole; i += FRAME) clean.set(frame(r, mic.subarray(i, i + FRAME), loop.subarray(i, i + FRAME)), i);
  if (whole) post({ type: 'level', rep: rmsDb(clean), customer: rmsDb(loop.subarray(0, whole)) });
}

function frame(r, mic, loop) {
  const clean = r.aec ? r.aec.process(mic, loop) : mic;
  const allow = r.gate ? r.gate.push(clean, loop) : true;
  if (!call) return clean;
  for (const u of call.rep.push(clean, allow)) emit('rep', u);
  for (const u of call.customer.push(loop)) emit('customer', u);
  const h = call.health.push(rmsDb(clean), rmsDb(loop));
  if (h !== null) {
    log(h ? 'warn' : 'info', h ? 'no call audio 20 s into the call while the mic hears speech' : 'call audio heard');
    post({ type: 'health', customerSilent: h });
  }
  return clean;
}

function emit(channel, u) {
  call.clips[channel]++;
  post({ type: 'utt', channel, at: call.t0 + u.startMs, durationMs: u.durationMs, wav: encodeWav(u.samples) });
}

function endCall() {
  if (!call) return;
  for (const ch of ['rep', 'customer']) for (const u of call[ch].flush()) emit(ch, u);
  log('info', `call capture ended: ${call.clips.rep} rep clips, ${call.clips.customer} customer clips, echo=${cur?.mode}, coupling=${cur?.gate?.coupling.toFixed(3) ?? 'n/a'}`);
  call = null;
}

async function stop() {
  const r = cur;
  cur = null;
  if (!r) return;
  r.stopped = true;
  r.node.port.onmessage = null; // frames already queued must not land after stop
  r.mic?.getTracks().forEach(t => { t.onended = null; t.stop(); });
  for (const s of r.streams) s.getTracks().forEach(t => t.stop());
  navigator.mediaDevices.ondevicechange = null;
  r.aec?.free();
  await r.ctx.close().catch(() => {});
  log('info', 'capture off');
}

// For tests and DevTools: the live mic track (to simulate a device dropping) and the gate's learned coupling.
globalThis.samCapture = { micTrack: () => cur?.mic?.getAudioTracks()[0] ?? null, info: () => ({ mode: cur?.mode, coupling: cur?.gate?.coupling, aec3: !!lib }) };
