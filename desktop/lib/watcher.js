// Call detection from the Windows microphone-consent registry: an app whose LastUsedTimeStop is 0 is using the mic
// right now. One `reg query /s` child process per poll (no PowerShell), parsed here; the state machine below turns
// "who holds the mic" into "a call started" (start SAM Live / offer to) and "the call app let go" (end / offer to).
import { execFile } from 'node:child_process';
import fs from 'node:fs';

export const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
export const DETECT = {
  pollMs: 3000,
  releaseMs: 15000,   // meeting app off the mic this long during a live call -> end (auto mode) / "Call ended?" (manual)
  autoEndMs: 300000,  // manual mode, prompt unanswered: still off the mic and nobody spoke for this long -> end the call
};

// [app, platform, pattern]. Matched against the consent entry name: an MSIX package family (new Teams, Phone Link,
// WhatsApp) or, under NonPackaged, the exe path with '\' written as '#'. Browsers are 'browser' here; main turns a
// browser into 'meet' when a window title says Meet (browserPlatform).
export const MEETING_APPS = [
  ['Phone Link', 'phone-link', /^Microsoft\.YourPhone_|#PhoneExperienceHost\.exe$/i],
  ['Teams', 'teams', /^MSTeams_|#(ms-)?teams\.exe$/i],
  ['Zoom', 'zoom', /#zoom\.exe$/i],
  ['Webex', 'webex', /#(webex|atmgr|ciscocollabhost|webexhost)\.exe$/i],
  ['WhatsApp', 'whatsapp', /WhatsAppDesktop_|#whatsapp(\.root)?\.exe$/i],
  ['Slack', 'slack', /\.Slack_|#slack\.exe$/i],
  ['Chrome', 'browser', /#chrome\.exe$/i], ['Edge', 'browser', /#msedge\.exe$/i], ['Firefox', 'browser', /#firefox\.exe$/i],
  ['Brave', 'browser', /#brave\.exe$/i], ['Opera', 'browser', /#opera\.exe$/i], ['Arc', 'browser', /#arc\.exe$/i],
];
export const PLATFORM = Object.fromEntries(MEETING_APPS.map(([app, platform]) => [app, platform]));

/** A browser on the mic is Google Meet when a window title says so (the tab title is "Meet - abc-defg-hij"). */
export const browserPlatform = titles => titles.some(t => /(^|[\s(])Meet([\s–—:-]|$)|meet\.google\.com/.test(t)) ? 'meet' : 'browser';

/** `reg query <KEY> /s` output -> [{ name, inUse }], one per consent entry (subkeys of microphone and of NonPackaged). */
export function parseConsent(out) {
  const entries = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      const rest = line.slice(line.toLowerCase().indexOf('\\consentstore\\microphone') + '\\consentstore\\microphone'.length);
      const name = rest.replace(/^\\(NonPackaged\\)?/i, '');
      cur = name && !/^NonPackaged$/i.test(name) && !name.includes('\\') ? { name, inUse: false } : null;
      if (cur) entries.push(cur);
    } else if (cur) {
      const m = line.match(/^\s+LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-f]+)/i);
      if (m) cur.inUse = BigInt(m[1]) === 0n;
    }
  }
  return entries;
}

/** Meeting apps using the mic now. selfExe (SAM Live's own exe, which also holds the mic during a call) is skipped. */
export function micUsers(out, selfExe = '') {
  const self = selfExe.replace(/\\/g, '#').toLowerCase();
  const apps = new Set();
  for (const e of parseConsent(out)) {
    if (!e.inUse || (self && e.name.toLowerCase() === self)) continue;
    const hit = MEETING_APPS.find(([, , re]) => re.test(e.name));
    if (hit) apps.add(hit[0]);
  }
  return [...apps];
}

/** feed(apps, live, now) with each poll's result. Every event carries platform (PLATFORM[app]). Events:
 *  { type: 'started', app }  a meeting app took the mic while no call runs (once per mic session of that app)
 *  { type: 'using', apps, platforms }  the set of meeting apps on the mic changed
 *  { type: 'releasing', app, graceMs }  during a live call, the last meeting app just let go of the mic
 *  { type: 'released', app, autoEndMs }  ...and has stayed off it for releaseMs
 *  { type: 'back', app }     a meeting app took the mic again after 'releasing' */
export function createDetector(onEvent, k = DETECT) {
  let using = new Set(), held = null, offSince = null, released = false;
  const emit = (type, app, extra) => onEvent({ type, app, platform: PLATFORM[app] ?? null, ...extra });
  return function feed(apps, live, now = Date.now()) {
    const next = new Set(apps);
    for (const a of next) if (!using.has(a) && !live) emit('started', a);
    if ([...next].sort().join() !== [...using].sort().join()) onEvent({ type: 'using', apps: [...next], platforms: [...next].map(a => PLATFORM[a] ?? null) });
    using = next;
    if (!live) { held = null; offSince = null; released = false; return; }
    if (next.size) {
      held = [...next][0];
      if (offSince !== null) emit('back', held);
      offSince = null; released = false;
    } else if (held) { // only a call that some meeting app was part of can "end" this way
      if (offSince === null) { offSince = now; emit('releasing', held, { graceMs: k.releaseMs }); }
      if (!released && now - offSince >= k.releaseMs) { released = true; emit('released', held, { autoEndMs: k.autoEndMs }); }
    }
  };
}

/** Polls the registry and calls onApps(apps). SAM_LIVE_FAKE_REG=<file> reads that file instead (tests). */
export function watchMic(onApps, { selfExe = process.execPath, everyMs = DETECT.pollMs, log = () => {} } = {}) {
  let failing = false;
  const fake = process.env.SAM_LIVE_FAKE_REG;
  const done = (err, out) => {
    if (err) { if (!failing) log('warn', `mic registry poll failed: ${err.code ?? err.message}`); failing = true; return; }
    if (failing) log('info', 'mic registry poll recovered');
    failing = false;
    onApps(micUsers(out, selfExe));
  };
  const tick = () => fake ? fs.readFile(fake, 'utf8', done)
    : execFile('reg', ['query', KEY, '/s'], { windowsHide: true, timeout: 5000, maxBuffer: 4e6 }, done);
  tick();
  return setInterval(tick, everyMs);
}
