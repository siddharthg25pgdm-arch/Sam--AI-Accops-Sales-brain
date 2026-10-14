// Mic -> channel "rep", system loopback -> channel "customer", both as 16 kHz mono frames via an AudioWorklet.
import { Resampler, RATE } from './audio-core.js';

/** Starts both channels; one failing (no mic, loopback blocked) is reported in `errors` and the other keeps going. */
export async function startCapture({ micId, onFrame }) {
  let ctx;
  try { ctx = new AudioContext({ sampleRate: RATE }); } catch { ctx = new AudioContext(); } // Resampler covers the fallback
  await ctx.audioWorklet.addModule('worklet.js');
  const streams = [], nodes = [], errors = {};
  let mic = null;

  const tap = (channel, stream) => {
    const node = new AudioWorkletNode(ctx, 'tap', { numberOfOutputs: 0 });
    const rs = new Resampler(ctx.sampleRate);
    node.port.onmessage = e => onFrame(channel, rs.push(e.data));
    ctx.createMediaStreamSource(stream).connect(node);
    streams.push(stream); nodes.push(node);
  };

  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: micId ? { exact: micId } : undefined, channelCount: 1,
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    tap('rep', mic);
  } catch (e) { errors.rep = e; }

  try {
    const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    for (const t of sys.getVideoTracks()) { t.stop(); sys.removeTrack(t); } // only the loopback audio is wanted
    if (!sys.getAudioTracks().length) throw new Error('No system audio track was granted.');
    tap('customer', sys);
  } catch (e) { errors.customer = e; }

  await ctx.resume();
  return {
    errors,
    contextRate: ctx.sampleRate,
    setMuted: m => mic?.getAudioTracks().forEach(t => { t.enabled = !m; }), // a disabled track feeds silence, so the VAD just ends the utterance
    stop: () => {
      for (const n of nodes) n.port.onmessage = null; // frames already queued must not land after stop
      for (const s of streams) s.getTracks().forEach(t => t.stop());
      ctx.close();
    },
  };
}

export async function microphones() {
  return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications');
}
