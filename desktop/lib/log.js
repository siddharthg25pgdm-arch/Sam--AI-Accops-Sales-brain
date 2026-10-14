// userData/main.log, rotated to main.log.1 at 5 MB (so at most ~10 MB on disk). Main-process and renderer lines
// (forwarded over IPC) land here. Callers never pass tokens or transcript text; scrub() is a backstop for tokens.
import fs from 'node:fs';
import path from 'node:path';

export const LOG = { maxBytes: 5 * 1024 * 1024, maxLine: 2000 };
let file = null;

export function initLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'main.log');
}

export const scrub = s => String(s)
  .replace(/(bearer\s+)[\w\-.~+/=]+/gi, '$1[redacted]')
  .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
  .replace(/[\r\n]+/g, ' ')
  .slice(0, LOG.maxLine);

export function log(level, scope, msg) {
  if (!file) return;
  const line = `${new Date().toISOString()} ${String(level).toUpperCase().padEnd(5)} [${String(scope).slice(0, 40)}] ${scrub(msg)}\n`;
  try {
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) + line.length > LOG.maxBytes) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, line);
  } catch { /* logging must never take the app down */ }
}
