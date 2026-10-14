// The renderer's only door to the system. Each call is a named IPC; no ipcRenderer or Node objects leak through.
const { contextBridge, ipcRenderer } = require('electron');
const invoke = ch => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('sam', {
  state: invoke('state'),
  login: invoke('login'),
  signOut: invoke('signOut'),
  setServer: invoke('setServer'),
  api: invoke('api'),          // (method, '/api/live/...', json?) -> { ok, status, data }
  upload: invoke('upload'),    // (meetingId, channel, tMs, durationMs, wavBytes) -> { ok, status, data }
  open: invoke('open'),        // http(s) only, default browser
  openMeeting: invoke('openMeeting'),
  copy: invoke('copy'),
  setLive: on => ipcRenderer.send('live', !!on),
  setOpacity: v => ipcRenderer.send('opacity', Number(v)),
  window: action => ipcRenderer.send('window', action),
  onNav: cb => ipcRenderer.on('nav', (_e, to) => cb(to)),
  onVisible: cb => ipcRenderer.on('visible', (_e, v) => cb(v)),
});
