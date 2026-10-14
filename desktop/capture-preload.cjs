// Preload for the hidden capture window: commands in, audio events out, log lines. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sam', {
  post: msg => ipcRenderer.send('capture-out', msg),              // -> main -> overlay
  onCmd: cb => ipcRenderer.on('capture-cmd', (_e, msg) => cb(msg)), // overlay -> main -> here
  log: (level, msg) => ipcRenderer.send('log', String(level), String(msg)),
});
