'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Solo se carga en la interfaz local, nunca en la web del servidor.
contextBridge.exposeInMainWorld('webboxStatus', {
  reloadPage: () => ipcRenderer.send('webbox:reload-page')
});
