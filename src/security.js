'use strict';

const { createHash } = require('node:crypto');

function appIdentity(name) {
  return createHash('sha256').update(name.normalize('NFC'), 'utf8').digest('hex');
}

function isLocalNavigation(value, port) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(url.hostname)
      && Number(url.port || 80) === port
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isExternalUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
      && !url.username && !url.password
      && (url.protocol === 'mailto:' ? !!url.pathname : !!url.hostname);
  } catch {
    return false;
  }
}

function denyPermissions(session) {
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setDevicePermissionHandler(() => false);
}

// webRequest cubre también la carga inicial de iframes, que puede omitir will-frame-navigate.
const sessionViews = new WeakMap();
function restrictSessionNavigation(session, contentsId, port, debug = false) {
  let views = sessionViews.get(session);
  if (!views) {
    views = new Map();
    sessionViews.set(session, views);
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (!['mainFrame', 'subFrame'].includes(details.resourceType)) return callback({});
      const view = views.get(details.webContentsId);
      // El inspector creado por Electron comparte sesión pero tiene otro ID.
      // Solo --debug habilita su documento interno; la web registrada conserva
      // siempre el filtro HTTP local, también para sus iframes.
      if (!view && [...views.values()].some(value => value.debug) && details.url.startsWith('devtools://devtools/')) return callback({});
      callback({ cancel: !isLocalNavigation(details.url, view?.port) });
    });
  }
  views.set(contentsId, { port, debug });
  return () => views.delete(contentsId);
}

module.exports = { appIdentity, isLocalNavigation, isExternalUrl, denyPermissions, restrictSessionNavigation };
