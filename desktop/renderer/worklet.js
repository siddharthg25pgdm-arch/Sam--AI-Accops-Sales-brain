// Audio thread: downmix to mono and post 100 ms batches to the page. Framing and VAD live in audio-core.js.
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.size = Math.round(sampleRate / 10); this.buf = new Float32Array(this.size); this.n = 0; }
  process([chans]) {
    if (!chans?.length) return true;
    for (let i = 0; i < chans[0].length; i++) {
      let s = 0;
      for (const c of chans) s += c[i];
      this.buf[this.n++] = s / chans.length;
      if (this.n === this.size) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(this.size); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('tap', Tap);
