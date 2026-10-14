// Test helper: synthesise phrases offline with Windows SAPI, read/write 16 kHz mono WAVs, play through the speakers.
import { execFileSync, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { encodeWav, rmsDb, RATE } from '../renderer/audio-core.js';

const ps = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
const q = s => `'${s.replace(/'/g, "''")}'`;

/** One 16 kHz mono WAV per phrase -> [{ file, text, ms, voicedMs }]. */
export function synthesize(phrases, dir) {
  const files = phrases.map((_, i) => path.join(dir, `phrase-${i + 1}.wav`));
  ps(`Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
${phrases.map((p, i) => `$s.SetOutputToWaveFile(${q(files[i])}, $f); $s.Speak(${q(p)})`).join('\n')}
$s.SetOutputToNull(); $s.Dispose()`);
  return phrases.map((text, i) => { const pcm = readWav(files[i]); return { file: files[i], text, ms: Math.round(pcm.length / RATE * 1000), voicedMs: voicedMs(pcm) }; });
}

export function readWav(file) {
  const b = fs.readFileSync(file);
  for (let o = 12; o + 8 <= b.length; o += 8 + b.readUInt32LE(o + 4)) {
    if (b.toString('ascii', o, o + 4) !== 'data') continue;
    const n = Math.floor(Math.min(b.readUInt32LE(o + 4), b.length - o - 8) / 2), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
    return out;
  }
  throw new Error(`no data chunk in ${file}`);
}

/** First-to-last 20 ms frame above -45 dBFS: the stretch a VAD should cover. */
export function voicedMs(pcm) {
  let first = -1, last = -1;
  for (let i = 0, f = 0; i + 320 <= pcm.length; i += 320, f++) if (rmsDb(pcm.subarray(i, i + 320)) > -45) { if (first < 0) first = f; last = f; }
  return first < 0 ? 0 : (last - first + 1) * 20;
}

/** Phrases joined with silence, as one WAV (Chromium's fake mic loops it). */
export function joinWithSilence(items, gapMs, file) {
  const gap = new Float32Array(gapMs * RATE / 1000), parts = items.flatMap(it => [readWav(it.file), gap]);
  const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
  fs.writeFileSync(file, encodeWav(all));
  return file;
}

/** Plays each file on the default output device, gapMs apart. Async so an in-process stub keeps serving meanwhile. */
export function playThroughSpeakers(files, gapMs) {
  const script = files.map(f => `(New-Object System.Media.SoundPlayer ${q(f)}).PlaySync(); Start-Sleep -Milliseconds ${gapMs}`).join('\n');
  return new Promise((resolve, reject) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, e => (e ? reject(e) : resolve())));
}
