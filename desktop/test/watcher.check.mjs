// Run: node desktop/test/watcher.check.mjs - tasklist parsing and once-per-run notifications.
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { meetingApps, appearances } from '../lib/watcher.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const row = name => `"${name}","1234","Console","1","120,000 K"`;
const snap = (...names) => ['System Idle Process', 'explorer.exe', ...names].map(row).join('\r\n');

ok(meetingApps(snap('ms-teams.exe')).join() === 'Teams', 'new Teams');
ok(meetingApps(snap('Teams.exe', 'Zoom.exe')).join() === 'Teams,Zoom', 'classic Teams + Zoom, case-insensitive');
ok(meetingApps(snap('atmgr.exe')).join() === 'Webex', 'Webex meeting manager');
ok(meetingApps(snap('msteams_autostarter.exe', 'zoomit.exe')).length === 0, 'look-alike names ignored');

const fired = [], feed = appearances(a => fired.push(a));
feed(snap('ms-teams.exe')); feed(snap('ms-teams.exe')); feed(snap('ms-teams.exe', 'Zoom.exe'));
feed(snap()); feed(snap('ms-teams.exe'));
ok(fired.join() === 'Teams,Zoom,Teams', `once per app run, re-armed after exit: ${fired}`);

// The real tasklist output parses without throwing (format check on this machine).
const real = execFileSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
ok(Array.isArray(meetingApps(real)) && /"[^"]+\.exe"/i.test(real), 'real tasklist output parses');
console.log(`watcher.check: ${n} assertions passed (running now: ${meetingApps(real).join(', ') || 'none'})`);
