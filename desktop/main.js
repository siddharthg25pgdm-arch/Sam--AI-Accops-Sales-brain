// SAM Live main process: overlay window, hidden capture window, tray, system-audio grant, SAM API proxy,
// call detection (mic-consent registry), log file.
import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, session, desktopCapturer, shell, clipboard, screen, protocol, net, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as store from './lib/store.js';
import { watchMic, createDetector, browserPlatform } from './lib/watcher.js';
import { initLog, log } from './lib/log.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, 'renderer');
const VENDOR = path.join(here, 'node_modules', '@ennuicastr', 'webrtcaec3.js', 'dist'); // AEC3 (BSD-3), served as /vendor/
const VENDOR_FILES = new Set(['webrtcaec3-0.3.0.js', 'webrtcaec3-0.3.0.wasm']);
const ORIGIN = 'app://samlive';
const ICON = path.join(here, 'assets', 'icon.ico'), ICON_LIVE = path.join(here, 'assets', 'tray-live.ico');
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const ECHO = ['aec3', 'browser+gate', 'browser'].includes(process.env.SAM_LIVE_ECHO) ? process.env.SAM_LIVE_ECHO : 'aec3';

if (process.env.SAM_LIVE_PROFILE) app.setPath('userData', process.env.SAM_LIVE_PROFILE); // tests use a throwaway profile
// Invisible mode must never hide the overlay from the rep: in a remote session (VDI, RDP) leave it capturable.
app.commandLine.appendSwitch('disable-features', 'AllowWindowCaptureExclusionInRemoteSessions');
// A real origin (not file://) so CSP 'self', module scripts and the AudioWorklet all behave.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setAppUserModelId('com.accops.samlive');

let win, cap, tray, note, live = false, quitting = false, capRestarts = 0;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(ready);
}

function ready() {
  initLog(app.getPath('userData'));
  log('info', 'main', `SAM Live ${app.getVersion()} starting (Electron ${process.versions.electron}, echo=${ECHO})`);
  protocol.handle('app', req => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    if (p.startsWith('/vendor/')) {
      const name = p.slice(8);
      return VENDOR_FILES.has(name) ? net.fetch(pathToFileURL(path.join(VENDOR, name)).href) : new Response('', { status: 404 });
    }
    const file = path.normalize(path.join(RENDERER, p));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

  const ses = session.defaultSession, MEDIA = new Set(['media', 'display-capture']);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(MEDIA.has(perm) && wc.getURL().startsWith(ORIGIN + '/')));
  ses.setPermissionCheckHandler((wc, perm, origin) => MEDIA.has(perm) && origin === ORIGIN);
  // System audio: getDisplayMedia is answered with the primary screen plus WASAPI loopback of the default
  // output device (Electron needs a video source alongside; the capture window stops that track immediately).
  ses.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(([src]) => cb(src ? { video: src, audio: 'loopback' } : null), () => cb(null));
  });

  createWindow();        // first, so it is the app's first window
  createCaptureWindow();
  createTray();
  const feed = createDetector(onDetect);
  watchMic(apps => feed(apps, live), { log: (level, msg) => log(level, 'detector', msg) });
}

const PREFS = { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' };

function createWindow() {
  const s = store.settings();
  win = new BrowserWindow({
    ...placement(s.bounds), minWidth: 340, minHeight: 500, frame: false, alwaysOnTop: true, show: false,
    backgroundColor: '#f5f5f7', title: 'SAM Live', icon: ICON,
    webPreferences: { ...PREFS, preload: path.join(here, 'preload.cjs') }, // backgroundThrottling off: uploads keep time while hidden
  });
  win.setContentProtection(s.invisible); // invisible mode: not in Teams/Zoom screen shares or recordings
  win.setOpacity(s.opacity);
  win.loadURL(`${ORIGIN}/index.html`);
  win.once('ready-to-show', () => win.show());
  guard(win);
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } }); // lives in the tray; Quit is in the tray menu
  let t;
  const keep = () => { clearTimeout(t); t = setTimeout(() => store.save({ bounds: win.getBounds() }), 400); };
  win.on('move', keep); win.on('resize', keep);
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, () => win.webContents.send('visible', win.isVisible() && !win.isMinimized()));
  win.webContents.on('render-process-gone', (_e, d) => log('error', 'main', `overlay renderer gone: ${d.reason}`));
}

// Audio lives here, never shown, so hiding/reloading the overlay can't stop a call. Restarted if it crashes;
// main replays the overlay's last wishes (want) once it says it's ready.
const want = { mute: { cmd: 'mute', on: false }, run: { cmd: 'run', on: false, micId: '' }, call: { cmd: 'call', on: false } };
let capReady = false;
function createCaptureWindow() {
  capReady = false;
  cap = new BrowserWindow({
    show: false, width: 1, height: 1, frame: false, skipTaskbar: true, focusable: false, title: 'SAM Live capture',
    webPreferences: { ...PREFS, preload: path.join(here, 'capture-preload.cjs') },
  });
  cap.loadURL(`${ORIGIN}/capture.html?echo=${encodeURIComponent(ECHO)}`);
  guard(cap);
  cap.webContents.on('render-process-gone', (_e, d) => {
    log('error', 'main', `capture renderer gone: ${d.reason}`);
    capReady = false;
    if (quitting || ++capRestarts > 5) return;
    setTimeout(() => { if (!cap.isDestroyed()) cap.destroy(); createCaptureWindow(); }, 1000);
  });
}

function guard(w) {
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// Saved bounds only if the title bar is still on some display (monitor unplugged = back to the default corner).
function placement(b) {
  const onScreen = b && screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 8 && b.y < a.y + a.height - 40);
  if (onScreen) return b;
  const a = screen.getPrimaryDisplay().workArea;
  return { width: 380, height: 640, x: a.x + a.width - 380 - 16, y: a.y + 16 };
}

function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip('SAM Live');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: show },
    { label: 'Start call', click: startCall },
    { type: 'separator' },
    { label: 'Quit', click: quitApp },
  ]));
  tray.on('click', show);
}

function show() { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function startCall() { show(); win.webContents.send('nav', 'start'); }
function quitApp() {
  if (live && dialog.showMessageBoxSync(win, {
    type: 'warning', buttons: ['Keep listening', 'Quit'], defaultId: 0, cancelId: 0, title: 'SAM Live',
    message: 'A call is still being captured.', detail: 'Quitting stops listening. End the call first to get the summary.',
  }) === 0) return;
  app.quit();
}

// Call detection: a meeting app took the mic (offer to start), or let go of it during a live call (overlay asks "Call ended?").
// Auto mode (default): the overlay starts the call itself and ends it when the app lets go of the mic. Manual mode:
// a notification offers to start, and the overlay asks "Call ended?". A plain browser on the mic (not Meet) is too
// often something else (dictation, a video), so it only ever gets the notification.
async function onDetect(e) {
  if (e.platform === 'browser') e.platform = await windowTitles().then(browserPlatform, () => 'browser');
  log('info', 'detector', e.type === 'using' ? `on the mic: ${e.apps.join(', ') || 'no meeting app'}` : `${e.type} ${e.app} (${e.platform})`);
  if (e.type !== 'started') return win.webContents.send('detector', e);
  if (live) return;
  if (store.settings().auto && e.platform !== 'browser') {
    if (!win.isVisible()) win.showInactive(); // the rep's call app keeps focus
    return win.webContents.send('detector', e);
  }
  if (!Notification.isSupported()) return;
  note = new Notification({ title: `Call started in ${e.app}. Start SAM Live?`, body: 'Click to set up the call.', icon: ICON });
  note.on('click', startCall);
  note.show();
}
const windowTitles = () => desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
  .then(list => list.map(w => w.name));

// ---- SAM API proxy: the token stays in this process; the renderer only sees response bodies.
const TIMEOUT = p => /\/end$/.test(p) ? 120000 : /\/assist$/.test(p) ? 30000 : 45000; // /end writes the summary; /audio may run an insight
async function request(method, p, { json, body, type, anonymous } = {}) {
  const headers = {};
  const t = anonymous ? null : store.token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  else if (body) headers['content-type'] = type;
  const route = `${method} ${p.split('?')[0]}`, t0 = Date.now();
  try {
    const r = await net.fetch(new URL(p, store.settings().server).href, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT(p)) });
    if (!r.ok) log('warn', 'api', `${route} -> ${r.status} in ${Date.now() - t0} ms`);
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
  } catch (x) {
    log('warn', 'api', `${route} -> ${x?.name === 'TimeoutError' ? 'timeout' : 'network error'} after ${Date.now() - t0} ms`);
    return { ok: false, status: 0, data: null }; // offline / DNS / timeout - callers retry
  }
}

const fromOverlay = e => e.sender === win?.webContents && e.senderFrame?.url.startsWith(ORIGIN + '/');
const fromCapture = e => e.sender === cap?.webContents && e.senderFrame?.url.startsWith(ORIGIN + '/');
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromOverlay(e)) throw new Error('blocked'); return fn(...a); });
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (fromOverlay(e)) fn(...a); });

handle('state', () => {
  const s = store.settings();
  return { server: s.server, user: store.token() ? s.user : null, opacity: s.opacity, invisible: s.invisible, auto: s.auto, version: app.getVersion() };
});
handle('login', async (id, password) => {
  const r = await request('POST', '/api/live/login', { json: { id: String(id), password: String(password) }, anonymous: true });
  if (!r.ok || !r.data?.token) return { ok: false, status: r.status, error: r.data?.error };
  store.setToken(r.data.token);
  store.save({ user: r.data.user ?? { id: String(id) } });
  log('info', 'main', 'signed in');
  return { ok: true, user: r.data.user };
});
handle('signOut', () => { store.setToken(null); store.save({ user: null }); log('info', 'main', 'signed out'); });
handle('setServer', url => {
  const u = new URL(String(url).trim());
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL.test(u.hostname)))) throw new Error('Use an https:// address.');
  if (u.origin !== store.settings().server) { store.setToken(null); store.save({ server: u.origin, user: null }); }
  return u.origin;
});
handle('api', (method, p, json) => {
  if (!['GET', 'POST', 'PATCH'].includes(method) || !/^\/api\/live\/[\w\-/?=&%.+()'!*~]*$/.test(p) || p.includes('..')) throw new Error('bad request');
  return request(method, p, { json });
});
handle('upload', (meetingId, channel, tMs, durationMs, wav) => {
  if (!['rep', 'customer'].includes(channel) || !(wav instanceof Uint8Array) || wav.length > 4e6) throw new Error('bad upload');
  const q = new URLSearchParams({ channel, t_ms: String(Math.max(0, Math.round(tMs))), duration_ms: String(Math.round(durationMs)) });
  return request('POST', `/api/live/meetings/${encodeURIComponent(meetingId)}/audio?${q}`, { body: wav, type: 'audio/wav' });
});
handle('open', url => {
  const u = new URL(String(url));
  if (u.protocol === 'https:' || u.protocol === 'http:') return shell.openExternal(u.href);
});
handle('openMeeting', id => shell.openExternal(new URL(`/live/${encodeURIComponent(id)}`, store.settings().server).href));
handle('copy', text => clipboard.writeText(String(text)));
handle('setAuto', v => { store.save({ auto: !!v }); log('info', 'main', `auto mode ${v ? 'on' : 'off'}`); return !!v; });
handle('setInvisible', v => {
  const on = !!v;
  win.setContentProtection(on);
  store.save({ invisible: on });
  log('info', 'main', `invisible mode ${on ? 'on' : 'off'}`);
  return on;
});
on('live', v => {
  live = !!v;
  log('info', 'main', live ? 'call live' : 'call not live');
  tray.setImage(live ? ICON_LIVE : ICON);
  tray.setToolTip(live ? 'SAM Live — listening' : 'SAM Live');
});
on('opacity', v => { const o = Math.min(1, Math.max(0.6, Number(v) || 1)); win.setOpacity(o); store.save({ opacity: o }); });
on('window', a => { if (a === 'hide') win.hide(); else if (a === 'minimize') win.minimize(); });

// Overlay -> capture commands (validated, remembered for a capture restart) and capture -> overlay events.
on('capture', m => {
  if (!m || !want[m.cmd]) return;
  want[m.cmd] = { cmd: m.cmd, on: !!m.on, ...(m.cmd === 'run' ? { micId: String(m.micId ?? '').slice(0, 200) } : {}),
    ...(m.cmd === 'call' ? { platform: String(m.platform ?? '').slice(0, 20) } : {}) };
  if (capReady) cap.webContents.send('capture-cmd', want[m.cmd]);
});
ipcMain.on('capture-out', (e, m) => {
  if (!fromCapture(e) || !m?.type) return;
  if (m.type === 'ready') {
    capReady = true;
    for (const c of [want.mute, want.run, ...(want.call.on ? [want.call] : [])]) cap.webContents.send('capture-cmd', c);
    return;
  }
  if (m.type === 'mic') log(m.state === 'ok' ? 'info' : 'warn', 'capture', `microphone ${m.state}`);
  win?.webContents.send('capture', m);
});
ipcMain.on('log', (e, level, msg) => {
  const scope = fromOverlay(e) ? 'overlay' : fromCapture(e) ? 'capture' : null;
  if (scope) log(['info', 'warn', 'error'].includes(level) ? level : 'info', scope, msg);
});
