// Run: node desktop/test/watcher.check.mjs - mic-consent registry parsing and the call-detection state machine.
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { parseConsent, micUsers, createDetector, browserPlatform, PLATFORM, KEY, DETECT } from '../lib/watcher.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const H = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const entry = (name, stop, np = false) => [`${H}${np ? '\\NonPackaged' : ''}\\${name}`, '    Value    REG_SZ    Allow',
  ...(stop === undefined ? [] : ['    LastUsedTimeStart    REG_QWORD    0x1dd2a1b31ca0695', `    LastUsedTimeStop    REG_QWORD    ${stop}`]), ''].join('\r\n');
const SELF = 'C:\\Users\\rep\\AppData\\Local\\Programs\\sam-live\\SAM Live.exe';
const snap = using => [
  `${H}\r\n    Value    REG_SZ    Allow\r\n`,
  entry('MSTeams_8wekyb3d8bbwe', using.includes('teams') ? '0x0' : '0x1dd2a1c7826da51'),
  entry('Microsoft.YourPhone_8wekyb3d8bbwe', using.includes('phone') ? '0x0' : '0x1dd2a1c7826da51'), // Phone Link (package family checked on this PC)
  entry('Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe', '0x0'),                       // on the mic, not a meeting app
  entry('Microsoft.XboxGamingOverlay_8wekyb3d8bbwe'),                                 // never used: no times at all
  `${H}\\NonPackaged\r\n    Value    REG_SZ    Allow\r\n`,
  entry('C:#Users#rep#AppData#Roaming#Zoom#bin#Zoom.exe', using.includes('zoom') ? '0x0' : '0x1dd5ae35d1762c9', true),
  entry('C:#Program Files#Google#Chrome#Application#chrome.exe', using.includes('chrome') ? '0x0' : '0x1dd5ae35d1762c9', true),
  entry(SELF.replace(/\\/g, '#'), '0x0', true),                                      // SAM Live itself, always on the mic in a call
  entry('C:#Users#rep#AppData#Local#Microsoft#Teams#current#Teams.exe', using.includes('classic') ? '0x0' : '0x1dc0', true),
].join('\r\n');

const e = parseConsent(snap(['teams']));
ok(e.length === 8 && e.every(x => !x.name.includes('\\')), `one entry per app, NonPackaged parent skipped (${e.map(x => x.name).join(' | ')})`);
ok(e.find(x => x.name.startsWith('MSTeams')).inUse && !e.find(x => x.name.includes('Xbox')).inUse, 'LastUsedTimeStop 0x0 = in use; no times = not in use');
ok(micUsers(snap(['teams']), SELF).join() === 'Teams', 'new Teams (MSIX key) on the mic; Sound Recorder and SAM Live itself ignored');
ok(micUsers(snap(['zoom', 'chrome']), SELF).sort().join() === 'Chrome,Zoom', 'Zoom and a browser (Meet / WhatsApp Web) under NonPackaged');
ok(micUsers(snap(['classic']), SELF).join() === 'Teams', 'classic Teams.exe');
ok(micUsers(snap([]), SELF).length === 0, 'nobody on the mic');
ok(micUsers(snap(['phone']), SELF).join() === 'Phone Link' && PLATFORM['Phone Link'] === 'phone-link', 'Phone Link (Microsoft.YourPhone MSIX key) on the mic -> platform phone-link');
ok(['Teams', 'Zoom', 'Webex', 'WhatsApp', 'Slack', 'Chrome'].map(a => PLATFORM[a]).join() === 'teams,zoom,webex,whatsapp,slack,browser', 'platform label per app');
ok(browserPlatform(['Meet - abc-defg-hij - Google Chrome', 'Inbox - Outlook']) === 'meet' && browserPlatform(['Meet – Daily stand-up - Microsoft Edge']) === 'meet'
  && browserPlatform(['meet.google.com/abc-defg-hij']) === 'meet', 'a browser with a Meet window -> meet');
ok(browserPlatform(['WhatsApp - Google Chrome', 'Meeting notes.docx - Word']) === 'browser' && browserPlatform([]) === 'browser', 'any other browser use -> browser');
ok(micUsers(snap([]), '').join() === '', 'without selfExe SAM Live (not a meeting app) still does not count');

// ---- state machine, fake clock, polled every 3 s
const raw = [], ev = [], feed = createDetector(x => { raw.push(x); ev.push(x.type === 'using' ? `using:${x.apps}` : `${x.type}:${x.app}${x.autoEndMs ? `:${x.autoEndMs}` : ''}${x.graceMs ? `:${x.graceMs}` : ''}`); });
let t = 0;
const poll = (apps, live, secs = 3) => { for (let s = 0; s < secs; s += 3) { feed(apps, live, t); t += 3000; } };
poll([], false, 6);
poll(['Teams'], false, 9);                       // call starts in Teams -> one notification, not repeated
ok(ev.join() === 'started:Teams,using:Teams', `Teams takes the mic -> one "started" (${ev})`);
ev.length = 0;
poll(['Teams'], true, 30);                       // rep starts SAM Live; call runs
poll([], true, 12);                              // Teams lets go: 12 s is still inside the grace
ok(ev.join() === `using:,releasing:Teams:${DETECT.releaseMs}`, `Teams lets go -> "releasing" at once (auto mode counts down from it); nothing else inside the grace (${ev})`);
poll([], true, 6);
ok(ev.join() === `using:,releasing:Teams:${DETECT.releaseMs},released:Teams:${DETECT.autoEndMs}`, `15 s off the mic during a live call -> one "released" (${ev})`);
ok(raw.filter(x => x.type !== 'using').every(x => x.platform === 'teams'), 'every event carries the platform');
poll([], true, 30);
ok(ev.filter(x => x.startsWith('released')).length === 1, 'released fires once');
ev.length = 0;
poll(['Teams'], true, 3);                        // rejoined
ok(ev.join() === 'using:Teams,back:Teams', `back on the mic -> "back" (${ev})`);
ev.length = 0;
poll([], true, 6); poll(['Teams'], true, 3);        // a 6 s blip off the mic (rejoining) -> releasing, back, never released
ok(ev.join() === 'using:,releasing:Teams:15000,using:Teams,back:Teams', `short blip: releasing then back (${ev})`);
ev.length = 0;
poll(['Phone Link'], false, 3);
ok(raw.at(-2).type === 'started' && raw.at(-2).platform === 'phone-link', 'a Phone Link call starting -> started with platform phone-link');
ev.length = 0;
poll([], false, 3); poll(['Zoom'], false, 3); poll([], false, 3); poll(['Zoom'], false, 3);
ok(ev.filter(x => x.startsWith('started')).join() === 'started:Zoom,started:Zoom', 'each new mic session notifies again');
ev.length = 0;
poll([], true, 60);
ok(!ev.some(x => x.startsWith('released')), 'a call no meeting app was part of (phone on speaker) never "ends" this way');

// The real registry parses on this machine.
const real = execFileSync('reg', ['query', KEY, '/s'], { encoding: 'utf8', windowsHide: true });
ok(parseConsent(real).length > 0 && Array.isArray(micUsers(real, process.execPath)), 'real reg query output parses');
console.log(`watcher.check: ${n} assertions passed (on the mic now: ${micUsers(real, process.execPath).join(', ') || 'no meeting app'})`);
