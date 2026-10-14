// SAM Live main process: overlay window, tray, system-audio grant, SAM API proxy, meeting-app watcher.
import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, session, desktopCapturer, shell, clipboard, screen, protocol, net, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as store from './lib/store.js';
import { watchMeetingApps } from './lib/watcher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, 'renderer');
const ORIGIN = 'app://samlive';
const ICON = path.join(here, 'assets', 'icon.ico'), ICON_LIVE = path.join(here, 'assets', 'tray-live.ico');
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

if (process.env.SAM_LIVE_PROFILE) app.setPath('userData', process.env.SAM_LIVE_PROFILE); // tests use a throwaway profile
// A real origin (not file://) so CSP 'self', module scripts and the AudioWorklet all behave.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setAppUserModelId('com.accops.samlive');

let win, tray, note, live = false, quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(ready);
}

function ready() {
  protocol.handle('app', req => {
    const file = path.normalize(path.join(RENDERER, decodeURIComponent(new URL(req.url).pathname)));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

  const ses = session.defaultSession, MEDIA = new Set(['media', 'display-capture']);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(MEDIA.has(perm) && wc.getURL().startsWith(ORIGIN + '/')));
  ses.setPermissionCheckHandler((wc, perm, origin) => MEDIA.has(perm) && origin === ORIGIN);
  // System audio: getDisplayMedia is answered with the primary screen plus WASAPI loopback of the default
  // output device (Electron needs a video source alongside; the renderer stops that track immediately).
  ses.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(([src]) => cb(src ? { video: src, audio: 'loopback' } : null), () => cb(null));
  });

  createWindow();
  createTray();
  watchMeetingApps(onMeetingApp);
}

function createWindow() {
  const s = store.settings();
  win = new BrowserWindow({
    ...placement(s.bounds), minWidth: 340, minHeight: 500, frame: false, alwaysOnTop: true, show: false,
    backgroundColor: '#f5f5f7', title: 'SAM Live', icon: ICON,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: false, // keeps uploads and timers on time while hidden in the tray
    },
  });
  win.setOpacity(s.opacity);
  win.loadURL(`${ORIGIN}/index.html`);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } }); // lives in the tray; Quit is in the tray menu
  let t;
  const keep = () => { clearTimeout(t); t = setTimeout(() => store.save({ bounds: win.getBounds() }), 400); };
  win.on('move', keep); win.on('resize', keep);
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, () => win.webContents.send('visible', win.isVisible() && !win.isMinimized()));
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

function onMeetingApp(name) {
  if (live || !Notification.isSupported()) return;
  note = new Notification({ title: 'Meeting app running — start SAM Live?', body: `${name} is open. Click to set up the call.`, icon: ICON });
  note.on('click', startCall);
  note.show();
}

// ---- SAM API proxy: the token stays in this process; the renderer only sees response bodies.
async function request(method, p, { json, body, type, anonymous } = {}) {
  const headers = {};
  const t = anonymous ? null : store.token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  else if (body) headers['content-type'] = type;
  const timeout = p.endsWith('/end') ? 120000 : 45000; // /end writes the summary; /audio may run an insight in the same request
  try {
    const r = await net.fetch(new URL(p, store.settings().server).href, { method, headers, body, signal: AbortSignal.timeout(timeout) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, data: null }; // offline / DNS / timeout - callers retry
  }
}

const fromUs = e => e.senderFrame?.url.startsWith(ORIGIN + '/');
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromUs(e)) throw new Error('blocked'); return fn(...a); });
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (fromUs(e)) fn(...a); });

handle('state', () => {
  const s = store.settings();
  return { server: s.server, user: store.token() ? s.user : null, opacity: s.opacity, version: app.getVersion() };
});
handle('login', async (id, password) => {
  const r = await request('POST', '/api/live/login', { json: { id: String(id), password: String(password) }, anonymous: true });
  if (!r.ok || !r.data?.token) return { ok: false, status: r.status, error: r.data?.error };
  store.setToken(r.data.token);
  store.save({ user: r.data.user ?? { id: String(id) } });
  return { ok: true, user: r.data.user };
});
handle('signOut', () => { store.setToken(null); store.save({ user: null }); });
handle('setServer', url => {
  const u = new URL(String(url).trim());
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL.test(u.hostname)))) throw new Error('Use an https:// address.');
  if (u.origin !== store.settings().server) { store.setToken(null); store.save({ server: u.origin, user: null }); }
  return u.origin;
});
handle('api', (method, p, json) => {
  if (!['GET', 'POST'].includes(method) || !/^\/api\/live\/[\w\-/?=&%.+]*$/.test(p) || p.includes('..')) throw new Error('bad request');
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
on('live', v => {
  live = !!v;
  tray.setImage(live ? ICON_LIVE : ICON);
  tray.setToolTip(live ? 'SAM Live — listening' : 'SAM Live');
});
on('opacity', v => { const o = Math.min(1, Math.max(0.6, Number(v) || 1)); win.setOpacity(o); store.save({ opacity: o }); });
on('window', a => { if (a === 'hide') win.hide(); else if (a === 'minimize') win.minimize(); });
