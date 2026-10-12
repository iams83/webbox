'use strict';

const { app, dialog } = require('electron');
const { Launcher } = require('./launcher');

let launcher;
let quitting = false;

app.whenReady().then(async () => {
  if (process.platform !== 'win32') {
    dialog.showErrorBox('WebBox', 'Este lanzador solo admite Windows.');
    app.quit();
    return;
  }
  launcher = new Launcher();
  const argv = process.argv.slice(app.isPackaged ? 1 : 2);
  await launcher.start(argv);
}).catch(error => {
  dialog.showErrorBox('WebBox: error inesperado', error.message);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !launcher) return;
  event.preventDefault();
  quitting = true;
  launcher.close().catch(error => dialog.showErrorBox('WebBox: error al cerrar', error.message)).finally(() => app.quit());
});
