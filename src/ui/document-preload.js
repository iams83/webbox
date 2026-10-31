'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const argument = name => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
const channel = argument('--webbox-documents-channel');
const invoke = (action, value) => ipcRenderer.invoke(channel, action, value).catch(error => {
  throw new Error(error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''));
});
if (process.isMainFrame && channel && location.origin === argument('--webbox-documents-origin') && location.pathname === argument('--webbox-documents-path')) {
  contextBridge.exposeInMainWorld('webboxDocuments', {
    initial: () => invoke('initial'),
    open: () => invoke('open'),
    activate: id => invoke('activate', id),
    save: options => invoke('save', options),
    reset: () => invoke('reset')
  });
}
