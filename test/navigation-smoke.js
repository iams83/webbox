'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow } = require('electron');
const archive = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const { Launcher } = require(archive ? path.join(archive, 'src/launcher.js') : '../src/launcher');

const artifacts = path.resolve(__dirname, '../artifacts/navigation');
app.setPath('userData', path.join(artifacts, 'profile'));
app.on('window-all-closed', () => {});

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch {}
    await delay(25);
  }
  throw new Error('No se completó la navegación esperada.');
}

app.whenReady().then(async () => {
  let instance, outside, allowed;
  let exitCode = 0;
  const deadline = setTimeout(() => app.exit(1), 30000);
  const opened = [];
  let outsideRequests = 0;
  let rejectExternal = false;
  const checks = [];
  try {
    outside = http.createServer((_request, response) => { outsideRequests++; response.end('OUTSIDE'); });
    await new Promise(resolve => outside.listen(0, '127.0.0.1', resolve));
    const outsideUrl = `http://127.0.0.1:${outside.address().port}/external`;
    allowed = http.createServer((request, response) => {
      if (request.url === '/allowed/redirect') {
        response.writeHead(302, { Location: outsideUrl }); response.end();
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><h1>ALLOWED PREFIX</h1>');
      }
    });
    await new Promise(resolve => allowed.listen(0, '127.0.0.1', resolve));
    const allowedOrigin = `http://127.0.0.1:${allowed.address().port}`;
    const publicDir = path.join(artifacts, 'public');
    await fs.mkdir(publicDir, { recursive: true });
    for (const name of ['index.html', 'next.html']) await fs.writeFile(path.join(publicDir, name), '<!doctype html><h1>LOCAL APP</h1>');
    const manifest = path.join(artifacts, 'navigation.app.json');
    await fs.writeFile(manifest, JSON.stringify({
      name: 'Navigation smoke', static: { root: 'public' },
      navigation: { allowedPrefixes: [allowedOrigin + '/allowed'] }
    }));
    instance = new Launcher({ show: false, openExternal: async url => {
      if (rejectExternal) throw new Error('No hay navegador disponible (prueba)');
      opened.push(url);
    } });
    await instance.start([manifest]);
    assert.equal(instance.state, 'running', instance.error?.message);
    const contents = instance.webView.webContents;
    const click = (url, target = '') => contents.executeJavaScript(`(() => {
      const link = document.createElement('a'); link.href = ${JSON.stringify(url)};
      link.target = ${JSON.stringify(target)}; link.textContent = 'Enlace de prueba';
      document.body.append(link); link.click();
    })()`);
    const loaded = url => waitFor(() => contents.getURL() === url && !contents.isLoading());
    const local = instance.url + 'next.html';
    await click(local);
    await loaded(local);
    assert.equal(opened.length, 0);
    const localhost = local.replace('127.0.0.1', 'localhost');
    await click(localhost);
    await loaded(localhost);
    assert.equal(opened.length, 0);
    checks.push('localhost y 127.0.0.1 con el puerto de la aplicación permanecen dentro');

    await click(outsideUrl);
    await waitFor(() => opened.length === 1);
    assert.equal(contents.getURL(), localhost);
    assert.equal(outsideRequests, 0);
    checks.push('Un enlace externo normal se entrega al navegador sin cargarlo dentro');

    const windows = BrowserWindow.getAllWindows().length;
    await click(local, '_blank');
    await waitFor(() => opened.length === 2);
    await click(outsideUrl, '_blank');
    await waitFor(() => opened.length === 3);
    assert.equal(BrowserWindow.getAllWindows().length, windows);
    assert.equal(contents.getURL(), localhost);
    checks.push('target=_blank abre fuera tanto enlaces locales como externos y no crea ventanas Electron');

    const prefixed = allowedOrigin + '/allowed/page';
    await click(prefixed);
    await loaded(prefixed);
    assert.match(await contents.executeJavaScript('document.body.innerText'), /ALLOWED PREFIX/);
    const outsidePrefix = allowedOrigin + '/allowed-other';
    await click(outsidePrefix);
    await waitFor(() => opened.length === 4);
    assert.equal(contents.getURL(), prefixed);
    await click(prefixed, '_blank');
    await waitFor(() => opened.length === 5);
    checks.push('Los prefijos del manifiesto permiten sus rutas, sin aceptar rutas parecidas; _blank siempre abre fuera');

    await click(allowedOrigin + '/allowed/redirect');
    await waitFor(() => opened.length === 6);
    assert.equal(outsideRequests, 0);
    await click(local);
    await loaded(local);
    await contents.executeJavaScript(`(() => { const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(outsideUrl)}; document.body.append(frame); })()`);
    await delay(250);
    assert.equal(outsideRequests, 0);
    assert.equal(opened.length, 6);
    await contents.executeJavaScript('window.open("file:///C:/not-allowed"); undefined;');
    await delay(100);
    assert.equal(opened.length, 6);
    assert.deepEqual(opened, [outsideUrl, local, outsideUrl, outsidePrefix, prefixed, outsideUrl]);
    checks.push('Redirecciones externas se abren fuera; iframes externos y protocolos no admitidos se bloquean');

    rejectExternal = true;
    await click(outsideUrl);
    await waitFor(() => instance.state === 'error' && !instance.window.webContents.isLoading());
    assert.match(await instance.window.webContents.executeJavaScript('document.getElementById("message").textContent'), /No se pudo abrir el enlace externo/);
    checks.push('Un fallo del navegador muestra un diagnóstico recuperable');

    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ date: new Date().toISOString(), archive, checks, opened }, null, 2));
    for (const check of checks) console.log('PASS ' + check);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(deadline);
    await instance?.close();
    for (const server of [outside, allowed]) if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    app.exit(exitCode);
  }
});
