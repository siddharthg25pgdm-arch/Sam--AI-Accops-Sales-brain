// Run: node desktop/test/log.check.mjs - main.log rotation and token scrubbing.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initLog, log, LOG, scrub } from '../lib/log.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'samlive-log-'));
LOG.maxBytes = 2000;
initLog(dir);
for (let i = 0; i < 60; i++) log('info', 'test', `line ${i} ${'x'.repeat(40)}`);
const main = fs.readFileSync(path.join(dir, 'main.log'), 'utf8'), old = fs.readFileSync(path.join(dir, 'main.log.1'), 'utf8');
ok(main.length <= 2000 && old.length <= 2000, `both files stay under the cap (${main.length}, ${old.length})`);
ok(main.includes('line 59') && !fs.existsSync(path.join(dir, 'main.log.2')), 'newest lines in main.log, only one old file kept');
ok(/^\S+Z INFO  \[test\] line/.test(main), 'line format: time level [scope] message');
ok(scrub('auth Bearer abc.def-123 ok') === 'auth Bearer [redacted] ok' && scrub('t=eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl') === 't=[jwt]', 'tokens scrubbed');
ok(scrub('a\r\nb') === 'a b' && scrub('y'.repeat(5000)).length === LOG.maxLine, 'one line per entry, capped');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`log.check: ${n} assertions passed`);
