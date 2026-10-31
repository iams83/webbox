'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appIdentity, isLocalNavigation, isAllowedNavigation, isExternalUrl, denyPermissions, restrictSessionNavigation } = require('../src/security');

test('navegación limita host, puerto, protocolo y credenciales', () => {
  for (const url of ['http://127.0.0.1:12345/', 'http://localhost:12345/inicio?q=1#x']) {
    assert.equal(isLocalNavigation(url, 12345), true, url);
  }
  for (const url of [
    'http://127.0.0.1:12346/', 'https://localhost:12345/', 'ws://localhost:12345/',
    'http://localhost.evil:12345/', 'http://127.0.0.1:12345@evil.test/',
    'http://user@localhost:12345/', 'file:///C:/secret', 'javascript:alert(1)', 'garbage'
  ]) assert.equal(isLocalNavigation(url, 12345), false, url);
});

test('solo http, https y mailto pueden abrirse externamente', () => {
  for (const url of ['https://example.com/a%20b', 'http://localhost:12345/', 'mailto:user@example.com']) {
    assert.equal(isExternalUrl(url), true, url);
  }
  for (const url of [
    'file:///C:/secret', 'javascript:alert(1)', 'data:text/html,x',
    'ms-appinstaller:example', 'https://user:secret@example.com', 'https://example.com/\n', 'mailto:', 'garbage'
  ]) assert.equal(isExternalUrl(url), false, url);
});

test('los prefijos amplían la navegación local por origen y ruta, sin aceptar dominios ni rutas parecidos', () => {
  const prefixes = ['https://docs.example.com/app', 'http://localhost:{PORT}/extra/', 'https://www.example.com/'];
  for (const url of ['http://127.0.0.1:12345/', 'http://localhost:12345/', 'https://docs.example.com/app',
    'https://docs.example.com/app/sub?q=1#section', 'https://www.example.com/a']) {
    assert.equal(isAllowedNavigation(url, 12345, prefixes), true, url);
  }
  for (const url of ['https://docs.example.com/application', 'https://docs.example.com/app/../secret',
    'https://docs.example.com/app/%2e%2e/secret', 'https://docs.example.com.evil/app',
    'https://docs.example.com:444/app', 'http://docs.example.com/app', 'https://user@docs.example.com/app',
    'http://localhost:12346/extra/', 'file:///C:/secret']) {
    assert.equal(isAllowedNavigation(url, 12345, prefixes), false, url);
  }
});

test('identidad por nombre es segura para rutas y normaliza Unicode', () => {
  assert.match(appIdentity('../España?'), /^[a-f0-9]{64}$/);
  assert.notEqual(appIdentity('uno'), appIdentity('dos'));
  assert.equal(appIdentity('España'), appIdentity('Espan\u0303a'));
});

test('el filtro de documentos respeta cada vista de una sesión compartida', () => {
  let handler;
  const session = { webRequest: { onBeforeRequest: (_filter, fn) => handler = fn } };
  const removeFirst = restrictSessionNavigation(session, 1, 12345, false, ['https://docs.example.com/app/']);
  const removeSecond = restrictSessionNavigation(session, 2, 12346);
  const check = (webContentsId, url, resourceType = 'mainFrame') => {
    let result;
    handler({ webContentsId, url, resourceType }, value => result = value);
    return result.cancel ?? false;
  };
  assert.equal(check(1, 'http://127.0.0.1:12345/'), false);
  assert.equal(check(2, 'http://127.0.0.1:12346/'), false);
  assert.equal(check(1, 'http://127.0.0.1:12346/'), true);
  assert.equal(check(1, 'https://example.com/', 'subFrame'), true);
  assert.equal(check(1, 'https://docs.example.com/app/page'), false);
  assert.equal(check(1, 'https://docs.example.com/app/frame', 'subFrame'), false);
  assert.equal(check(2, 'https://docs.example.com/app/page'), true);
  assert.equal(check(1, 'https://example.com/image.png', 'image'), false);
  assert.equal(check(3, 'http://127.0.0.1:12345/'), true);
  removeFirst();
  assert.equal(check(1, 'http://127.0.0.1:12345/'), true);
  assert.equal(check(2, 'http://127.0.0.1:12346/'), false);
  removeSecond();
});

test('las comprobaciones, solicitudes y permisos de dispositivos se deniegan', () => {
  const handlers = {};
  denyPermissions({
    setPermissionCheckHandler: fn => handlers.check = fn,
    setPermissionRequestHandler: fn => handlers.request = fn,
    setDevicePermissionHandler: fn => handlers.device = fn
  });
  assert.equal(handlers.check(null, 'notifications', 'http://localhost'), false);
  assert.equal(handlers.device({ deviceType: 'usb' }), false);
  handlers.request(null, 'media', granted => assert.equal(granted, false));
});

test('debug autoriza el inspector interno y mantiene el filtro de la web', () => {
  let handler;
  const session = { webRequest: { onBeforeRequest: (_filter, fn) => handler = fn } };
  const check = (id, url, type = 'mainFrame') => {
    let result; handler({ webContentsId: id, url, resourceType: type }, value => result = value);
    return result.cancel ?? false;
  };
  const removeNormal = restrictSessionNavigation(session, 1, 12345);
  assert.equal(check(3, 'devtools://devtools/bundled/inspector.html'), true);
  const removeDebug = restrictSessionNavigation(session, 2, 12345, true);
  assert.equal(check(3, 'devtools://devtools/bundled/inspector.html'), false);
  assert.equal(check(1, 'devtools://devtools/bundled/inspector.html'), true);
  assert.equal(check(2, 'devtools://devtools/bundled/inspector.html', 'subFrame'), true);
  assert.equal(check(3, 'https://example.com'), true);
  assert.equal(check(3, 'devtools://other/inspector.html'), true);
  removeDebug();
  assert.equal(check(3, 'devtools://devtools/bundled/inspector.html'), true);
  removeNormal();
});
