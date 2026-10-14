// Pure audio helpers shared by the renderer and the node checks: no DOM, no Electron.
// Everything runs on 16 kHz mono Float32 samples in 20 ms frames.

export const RATE = 16000;
export const FRAME = 320; // 20 ms

// Calibration knobs. Loopback silence is digital zero (-180 dB), so minDb is what gates it.
export const VAD_DEFAULTS = {
  marginDb: 10,      // speech must be this far above the adaptive noise floor...
  minDb: -50,        // ...and never quieter than this, whatever the floor says
  preRollMs: 300,    // audio kept from before the onset so first syllables survive
  hangMs: 700,       // this much silence ends an utterance
  tailMs: 300,       // silence kept after the last speech frame
  maxMs: 15000,      // hard cut so one monologue never becomes one giant upload
  minSpeechMs: 600,  // fewer speech frames than this = cough/click; Whisper hallucinates on those
};

export function rmsDb(x) {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(sum / (x.length || 1)) + 1e-9);
}

/** Energy VAD. push() any number of samples; get back finished utterances
 *  { samples, startMs, durationMs, speechMs } with startMs counted from the first sample pushed. */
export class Vad {
  constructor(opts = {}) {
    const o = { ...VAD_DEFAULTS, ...opts };
    const f = ms => Math.round(ms / 20);
    this.k = { ...o, pre: f(o.preRollMs), hang: f(o.hangMs), tail: f(o.tailMs), max: f(o.maxMs), minSpeech: f(o.minSpeechMs) };
    this.buf = new Float32Array(FRAME); this.fill = 0;
    this.pos = 0;          // samples consumed, in whole frames
    this.floor = null;     // noise floor, dB
    this.pre = [];         // ring of recent non-speech frames
    this.cur = null;       // { frames, start, speech, silence }
    this.level = -180;
  }

  push(samples) {
    const out = [];
    for (let i = 0; i < samples.length;) {
      const n = Math.min(FRAME - this.fill, samples.length - i);
      this.buf.set(samples.subarray(i, i + n), this.fill); this.fill += n; i += n;
      if (this.fill === FRAME) { const u = this.#frame(this.buf.slice()); this.fill = 0; if (u) out.push(u); }
    }
    return out;
  }

  /** End of stream: emit whatever is in flight if it holds enough speech. */
  flush() {
    const u = this.cur && this.#close(false);
    return u ? [u] : [];
  }

  #frame(f) {
    const k = this.k, db = rmsDb(f);
    let done = null;
    this.level = db;
    if (this.floor === null) this.floor = db;
    const speech = db > Math.max(this.floor + k.marginDb, k.minDb);
    // Floor falls fast, rises slowly, and barely moves mid-utterance so a long sentence can't raise it.
    this.floor += (db - this.floor) * (db < this.floor ? 0.5 : this.cur ? 0.0005 : 0.02);

    if (!this.cur) {
      if (speech) this.cur = { frames: [...this.pre, f], start: this.pos - this.pre.length * FRAME, speech: 1, silence: 0 };
      else { this.pre.push(f); if (this.pre.length > k.pre) this.pre.shift(); }
    } else {
      this.cur.frames.push(f);
      if (speech) { this.cur.speech++; this.cur.silence = 0; } else this.cur.silence++;
      if (this.cur.silence >= k.hang) done = this.#close(false);
      else if (this.cur.frames.length >= k.max) done = this.#close(true);
    }
    this.pos += FRAME;
    return done;
  }

  // cut = hit maxMs mid-speech: keep everything, and clear pre-roll so the next piece doesn't repeat audio.
  #close(cut) {
    const { frames, start, speech, silence } = this.cur;
    this.cur = null; this.pre = [];
    if (speech < this.k.minSpeech) return null;
    const keep = cut ? frames.length : frames.length - Math.max(0, silence - this.k.tail);
    const samples = new Float32Array(keep * FRAME);
    for (let i = 0; i < keep; i++) samples.set(frames[i], i * FRAME);
    return { samples, startMs: start / RATE * 1000, durationMs: keep * 20, speechMs: speech * 20 };
  }
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples, rate = RATE) {
  const v = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(v.buffer);
}

/** Streaming box-filter resampler to 16 kHz, used only when the AudioContext refuses 16 kHz.
 *  ponytail: box average is a crude anti-alias filter; fine for speech-to-text, swap for a windowed sinc if it ever feeds music. */
export class Resampler {
  constructor(inRate, outRate = RATE) { this.r = inRate / outRate; this.t = 0; this.acc = 0; this.n = 0; this.last = 0; }
  push(x) {
    if (this.r === 1) return x;
    const out = [];
    for (let i = 0; i < x.length; i++) {
      this.acc += x[i]; this.n++; this.t += 1;
      while (this.t >= this.r) {
        if (this.n) { this.last = this.acc / this.n; this.acc = 0; this.n = 0; }
        out.push(this.last); this.t -= this.r;
      }
    }
    return Float32Array.from(out);
  }
}
