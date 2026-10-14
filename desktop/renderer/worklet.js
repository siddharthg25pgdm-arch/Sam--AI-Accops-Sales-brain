// Audio thread. Input 0 = mic, input 1 = system loopback. Both arrive in the same render quantum, so they are
// time-aligned by construction (no sequence pairing needed). Each is downmixed to mono and posted as 100 ms pairs.
// An unconnected input (no mic, loopback refused) reads as silence.
const mono = (chans, i) => {
  if (!chans?.length) return 0;
  let s = 0;
  for (const c of chans) s += c[i];
  return s / chans.length;
};

class Pair extends AudioWorkletProcessor {
  constructor() { super(); this.size = Math.round(sampleRate / 10); this.fresh(); }
  fresh() { this.mic = new Float32Array(this.size); this.loop = new Float32Array(this.size); this.n = 0; }
  process([mic, loop]) {
    const len = mic?.[0]?.length || loop?.[0]?.length || 128;
    for (let i = 0; i < len; i++) {
      this.mic[this.n] = mono(mic, i); this.loop[this.n] = mono(loop, i);
      if (++this.n === this.size) {
        this.port.postMessage({ mic: this.mic, loop: this.loop }, [this.mic.buffer, this.loop.buffer]);
        this.fresh();
      }
    }
    return true;
  }
}
registerProcessor('pair', Pair);
