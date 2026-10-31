'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, nativeTheme, nativeImage } = require('electron');
const { Launcher } = require('../src/launcher');
const { reservePort } = require('../src/ports');
const net = require('node:net');
const { createIco } = require('./helpers/icon-fixture');

const artifacts = path.resolve(__dirname, '../artifacts/startup');
const instances = [];
const checks = [];
app.setPath('userData', path.join(artifacts, 'profile'));
app.on('window-all-closed', () => {});

function launcher() {
  const instance = new Launcher({ show: false });
  instances.push(instance);
  return instance;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch {}
    await delay(25);
  }
  throw new Error('No se completó la transición de arranque/tema.');
}

async function verifyTheme(instance, theme, name) {
  nativeTheme.themeSource = theme;
  const background = theme === 'dark' ? 'rgb(32, 32, 32)' : 'rgb(243, 243, 243)';
  await waitFor(async () => await instance.window.webContents.executeJavaScript('getComputedStyle(document.documentElement).backgroundColor') === background);
  assert.equal(instance.window.getBackgroundColor().toLowerCase(), theme === 'dark' ? '#202020' : '#f3f3f3');
  await delay(100);
  let capture;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { capture = await instance.window.webContents.capturePage(undefined, { stayAwake: true }); break; }
    catch (error) { if (error.message !== 'UnknownVizError' || attempt === 2) throw error; await delay(300); }
  }
  assert.equal(capture.isEmpty(), false);
  await fs.writeFile(path.join(artifacts, name + '.png'), capture.toPNG());
}

app.whenReady().then(async () => {
  const originalTheme = nativeTheme.themeSource;
  const timeout = setTimeout(() => app.exit(1), 30000);
  let release;
  let exitCode = 0;
  try {
    await fs.mkdir(artifacts, { recursive: true });
    const exeIcon = path.join(artifacts, 'exe-icon.ico');
    const appIcon = path.join(artifacts, 'app-icon.ico');
    const runtimeIcon = path.join(artifacts, 'runtime-icon.ico');
    await fs.writeFile(exeIcon, createIco(200, 50, 50));
    await fs.writeFile(appIcon, createIco(40, 100, 200));
    await fs.writeFile(runtimeIcon, createIco(30, 180, 80));
    const manifestFile = path.join(artifacts, 'options.app.json');
    await fs.writeFile(manifestFile, JSON.stringify({ name: 'Options stable identity', title: 'Título del manifiesto',
      icon: appIcon, static: { root: path.resolve(__dirname, '../examples/static/public') }, port: { range: [1, 1] } }));
    const portOverride = await reservePort();
    nativeTheme.themeSource = 'dark';
    const instance = launcher();
    const originalLaunch = instance.launchServer.bind(instance);
    const gate = new Promise(resolve => { release = resolve; });
    instance.launchServer = async () => { await gate; if (!instance.closing) await originalLaunch(); };
    const pending = instance.start([manifestFile, '--port', String(portOverride), '--title', 'Título CLI · España', '--icon', runtimeIcon]);
    await waitFor(() => instance.window?.webContents.getURL().includes('/loading.html') && !instance.window.webContents.isLoading());
    assert.equal(instance.state, 'starting');
    assert.equal(instance.webView, null);
    assert.equal(await instance.window.webContents.executeJavaScript('document.body.innerText.trim()'), '');
    assert.equal(await instance.window.webContents.executeJavaScript('document.querySelector("[role=status]").getAttribute("aria-label")'), 'Cargando aplicación');
    await verifyTheme(instance, 'dark', 'loading-dark');
    await verifyTheme(instance, 'light', 'loading-light');
    release();
    await pending;
    assert.equal(instance.state, 'running', instance.error?.message);
    assert.equal(instance.server.port, portOverride);
    assert.equal(instance.window.getTitle(), 'Título CLI · España');
    assert.equal(instance.manifest.name, 'Options stable identity');
    assert.equal(instance.manifest.icon, runtimeIcon);
    assert.equal(nativeImage.createFromPath(runtimeIcon).isEmpty(), false);
    assert.equal(instance.webView.getVisible(), true);
    await waitFor(async () => await instance.webView.webContents.executeJavaScript('document.getElementById("result").textContent') === 'JavaScript estático activo.');
    const port = instance.server.port;
    instance.handlePageFailure(new Error('Fallo de página de prueba'));
    await waitFor(() => instance.window.webContents.getURL().includes('/status.html') && !instance.window.webContents.isLoading());
    assert.equal(await instance.window.webContents.executeJavaScript('document.getElementById("reload").hidden'), false);
    await instance.window.webContents.executeJavaScript('document.getElementById("reload").click(); undefined;');
    await waitFor(() => instance.state === 'running');
    assert.equal(instance.server.port, port, 'Recargar la página debe conservar el servidor.');
    await instance.close();
    assert.equal(nativeTheme.listeners('updated').includes(instance.themeHandler), false);
    checks.push('Cargador sin diagnóstico visible, claro/oscuro, transición a web y recarga tras error');
    checks.push('Puerto, título e icono CLI prevalecen sobre el manifiesto sin cambiar la identidad');

    const occupied = net.createServer();
    await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
    try {
      const busy = launcher();
      await busy.start([manifestFile, '--port', String(occupied.address().port)]);
      assert.equal(busy.state, 'error');
      assert.match(busy.error.message, /puerto fijo.*ocupado/);
      await busy.close();
    } finally { await new Promise(resolve => occupied.close(resolve)); }
    const invalidIcon = launcher();
    await invalidIcon.start([manifestFile, '--icon', path.join(artifacts, 'missing.ico')]);
    assert.equal(invalidIcon.state, 'error');
    assert.match(invalidIcon.error.message, /No se puede leer --icon/);
    await invalidIcon.close();
    checks.push('Puerto ocupado e icono inexistente muestran diagnóstico sin sustituciones silenciosas');

    const failed = launcher();
    await failed.start(['--title', 'Diagnóstico CLI']);
    assert.equal(failed.state, 'error');
    assert.equal(failed.window.getTitle(), 'Diagnóstico CLI');
    assert.match(await failed.window.webContents.executeJavaScript('document.getElementById("message").textContent'), /Falta el manifiesto/);
    assert.equal(await failed.window.webContents.executeJavaScript('document.getElementById("exit").hidden'), false);
    await verifyTheme(failed, 'light', 'error-light');
    await verifyTheme(failed, 'dark', 'error-dark');
    await failed.close();
    checks.push('Diagnóstico solo tras error y cambio de tema en vivo');

    const staticArgs = launcher();
    await staticArgs.start([path.resolve(__dirname, '../examples/static/app.app.json'), '--', 'datos.json']);
    assert.equal(staticArgs.state, 'error');
    assert.match(staticArgs.error.message, /web estática.*Node o Python/);
    assert.equal(staticArgs.server, null);
    await staticArgs.close();
    checks.push('Los argumentos de servidor en una web estática muestran un diagnóstico');

    const cancelled = launcher();
    const originalCancelledLaunch = cancelled.launchServer.bind(cancelled);
    const cancelledGate = new Promise(resolve => { release = resolve; });
    cancelled.launchServer = async () => { await cancelledGate; if (!cancelled.closing) await originalCancelledLaunch(); };
    const cancelledStart = cancelled.start([path.resolve(__dirname, '../examples/static/app.app.json')]);
    await waitFor(() => cancelled.window?.webContents.getURL().includes('/loading.html') && !cancelled.window.webContents.isLoading());
    await cancelled.close();
    release();
    await cancelledStart;
    assert.equal(cancelled.state, 'closed');
    assert.equal(cancelled.server, null);
    checks.push('Cerrar durante el cargador impide iniciar un servidor tardío');

    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ date: new Date().toISOString(), checks }, null, 2));
    for (const check of checks) console.log('PASS ' + check);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    release?.();
    clearTimeout(timeout);
    nativeTheme.themeSource = originalTheme;
    for (const instance of instances) await instance.close();
    app.exit(exitCode);
  }
});
