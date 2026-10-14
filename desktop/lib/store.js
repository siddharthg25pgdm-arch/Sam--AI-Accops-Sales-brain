// Settings (plain JSON) and the SAM bearer token (DPAPI-encrypted via safeStorage) in userData.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = { server: 'https://sam-accops.vercel.app', opacity: 1, bounds: null, user: null, invisible: true, auto: true };
const file = name => path.join(app.getPath('userData'), name);

export function settings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file('settings.json'), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
export function save(patch) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file('settings.json'), JSON.stringify({ ...settings(), ...patch }, null, 1));
}

// The token is decrypted per request and never logged or handed to the renderer.
let memoryOnly = null; // only if the OS can't encrypt: then it lives for this run and is never written in clear
export function token() {
  if (memoryOnly) return memoryOnly;
  try { return safeStorage.decryptString(fs.readFileSync(file('session.bin'))); } catch { return null; }
}
export function setToken(t) {
  memoryOnly = null;
  fs.rmSync(file('session.bin'), { force: true });
  if (!t) return;
  if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(file('session.bin'), safeStorage.encryptString(t));
  else memoryOnly = t;
}
