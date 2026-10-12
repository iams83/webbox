'use strict';

const path = require('node:path');

// Una sesión puede contener varias ventanas del mismo name.
const policies = new WeakMap();

function downloadFilename(value) {
  let name = path.win32.basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  if (!name || /^\.+$/.test(name)) name = 'descarga';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name.slice(0, 180).replace(/[. ]+$/, '');
}

function manageDownloads(contents, { directory, log, failed }) {
  const session = contents.session;
  let policy = policies.get(session);
  if (!policy) {
    const views = new Map();
    const handler = (event, item, source) => {
      const view = views.get(source?.id);
      if (!view || source.isDestroyed()) { event.preventDefault(); return; }
      // Conservar el flujo nativo de Electron: siempre elegir destino y confirmar
      // sobrescrituras, sin que la web reciba rutas del sistema ni APIs de Node.
      item.setSaveDialogOptions({
        title: 'Guardar archivo', buttonLabel: 'Guardar',
        defaultPath: path.join(view.directory, downloadFilename(item.getFilename())),
        properties: ['showOverwriteConfirmation']
      });
      view.items.add(item);
      item.once('done', (_event, state) => {
        view.items.delete(item);
        view.log(`[WebBox] Descarga ${state}: ${item.getFilename()}\n`);
        if (state === 'interrupted' && !view.closed) view.failed('No se pudo completar la descarga de «' + item.getFilename() + '».');
      });
    };
    policy = { views, handler };
    policies.set(session, policy);
    session.on('will-download', handler);
  }
  const view = { directory, log, failed, items: new Set(), closed: false };
  policy.views.set(contents.id, view);
  const remove = () => {
    if (view.closed) return;
    view.closed = true;
    policy.views.delete(contents.id);
    for (const item of view.items) item.cancel();
    view.items.clear();
    contents.removeListener('destroyed', remove);
    if (!policy.views.size) {
      session.removeListener('will-download', policy.handler);
      policies.delete(session);
    }
  };
  contents.once('destroyed', remove);
  return remove;
}

module.exports = { manageDownloads, downloadFilename };
