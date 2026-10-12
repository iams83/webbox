'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('webboxLog', {
  subscribe: callback => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('webbox:log-data', handler);
    ipcRenderer.send('webbox:log-action', 'snapshot');
    return () => ipcRenderer.removeListener('webbox:log-data', handler);
  },
  clear: () => ipcRenderer.send('webbox:log-action', 'clear'),
  copy: () => ipcRenderer.send('webbox:log-action', 'copy'),
  rendered: packet => ipcRenderer.send('webbox:log-action', 'ack', packet)
});
