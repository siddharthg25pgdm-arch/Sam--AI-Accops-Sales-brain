// WebRTC AEC3 (WebAssembly, @ennuicastr/webrtcaec3.js) with the system loopback as the far end, so whatever the PC
// plays (the customer) is removed from the mic. Pure: the capture window and the node checks both use it.
import { RATE } from './audio-core.js';

const AEC_RATE = 32000;        // AEC3 accepts 32 or 48 kHz; it resamples our 16 kHz in and out internally
const STEP = RATE / 100;       // AEC3 works in 10 ms frames

/** Instantiates the module from the library's factory and the .wasm bytes. Instantiation is done here so a failure
 *  (CSP without 'wasm-unsafe-eval', a broken file) rejects instead of triggering the library's own fallback, which
 *  reloads the page. */
export async function loadAec3(factory, wasmBytes) {
  const mod = await WebAssembly.compile(wasmBytes);
  let fail;
  const failed = new Promise((_, reject) => { fail = reject; });
  const ready = factory({
    instantiateWasm(imports, done) { WebAssembly.instantiate(mod, imports).then(inst => done(inst, mod), fail); return {}; },
    print: () => {}, printErr: () => {},
  });
  return Promise.race([ready, failed]);
}

/** One canceller. process() takes the same 20 ms of mic and call audio (16 kHz mono) and returns the cleaned mic.
 *  Far end then near end, every 10 ms, so AEC3's render buffer never runs ahead of the capture side. */
export function createAec(lib) {
  const aec = new lib.AEC3(AEC_RATE, 1, 1), out = [new Float32Array(STEP)];
  const inOnly = { sampleRateIn: RATE }, inOut = { sampleRateIn: RATE, sampleRateOut: RATE };
  return {
    process(mic, loop) {
      const clean = new Float32Array(mic.length);
      for (let i = 0; i + STEP <= mic.length; i += STEP) {
        aec.analyze([loop.subarray(i, i + STEP)], inOnly);
        aec.process(out, [mic.subarray(i, i + STEP)], inOut);
        clean.set(out[0], i);
      }
      return clean;
    },
    free: () => aec.free(),
  };
}
