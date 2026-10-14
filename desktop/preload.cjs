// The overlay's only door to the system. Each call is a named IPC; no ipcRenderer or Node objects leak through.
const { contextBridge, ipcRenderer } = require('electron');
const invoke = ch => (...a) => ipcRenderer.invoke(ch, ...a);
const listen = ch => cb => ipcRenderer.on(ch, (_e, v) => cb(v));

contextBridge.exposeInMainWorld('sam', {
  state: invoke('state'),
  login: invoke('login'),
  signOut: invoke('signOut'),
  setServer: invoke('setServer'),
  api: invoke('api'),          // (GET|POST|PATCH, '/api/live/...', json?) -> { ok, status, data }
  upload: invoke('upload'),    // (meetingId, channel, tMs, durationMs, wavBytes) -> { ok, status, data }
  open: invoke('open'),        // http(s) only, default browser
  openMeeting: invoke('openMeeting'),
  copy: invoke('copy'),
  setInvisible: invoke('setInvisible'),
  setAuto: invoke('setAuto'),
  setLive: on => ipcRenderer.send('live', !!on),
  setOpacity: v => ipcRenderer.send('opacity', Number(v)),
  window: action => ipcRenderer.send('window', action),
  capture: msg => ipcRenderer.send('capture', msg), // { cmd: 'run' | 'mute' | 'call', on, micId? } -> hidden capture window
  log: (level, msg) => ipcRenderer.send('log', String(level), String(msg)),
  onCapture: listen('capture'),   // levels, utterances, mic and call-audio status from the capture window
  onDetector: listen('detector'), // call detection: started (auto mode) / using / releasing / released / back
  onNav: listen('nav'),
  onVisible: listen('visible'),
});
