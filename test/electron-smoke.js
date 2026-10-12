'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, screen } = require('electron');
const http = require('node:http');
const { Launcher } = require('../src/launcher');
const { isPortOpen } = require('../src/server');

const artifacts = path.join(__dirname, '../artifacts/smoke');
const report = [];
const launchers = [];
const captures = {};
// Evita escribir perfiles de prueba en el userData real del usuario.
app.setPath('userData', path.join(artifacts, 'profile'));
// Las pruebas abren varias ventanas secuencialmente; cerrar una no debe terminar Electron.
app.on('window-all-closed', () => {});

function launcher(options = {}) {
  const instance = new Launcher({ show: false, ...options });
  launchers.push(instance);
  return instance;
}

async function waitFor(predicate, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await predicate()) return; } catch {}
    await delay(25);
  }
  throw new Error('No se cumplió la condición en ' + timeoutMs + ' ms.');
}

async function capture(contents, name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const image = await contents.capturePage(undefined, { stayAwake: true });
      assert.equal(image.isEmpty(), false);
      await fs.writeFile(path.join(artifacts, name + '.png'), image.toPNG());
      captures[name] = { result: 'captured' };
      return;
    } catch (error) {
      if (error.message !== 'UnknownVizError') throw error;
      if (attempt < 2) await delay(300);
      else {
        if (process.env.WEBBOX_REQUIRE_CAPTURES === '1') throw error;
        captures[name] = { result: 'unavailable', reason: error.message };
        console.warn('CAPTURE UNAVAILABLE ' + name + ': ' + error.message + ' (compositor de Chromium)');
      }
    }
  }
}

async function fixture(name, data) {
  const directory = path.join(artifacts, 'ruta con espacios y acentos España');
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, name);
  await fs.writeFile(filename, typeof data === 'string' ? data : JSON.stringify(data));
  return filename;
}

async function check(name, action) {
  await action();
  report.push({ name, result: 'passed' });
  console.log(`PASS ${name}`);
}

const basic = {
  name: 'Prueba España', title: 'Ventana de prueba · España', command: process.env.WEBBOX_TEST_NODE,
  args: [path.join(__dirname, '../examples/node/server.js')], window: { width: 1100, height: 760 },
  ready: { type: 'port', timeoutMs: 5000 }
};

app.whenReady().then(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  let exitCode = 0;
  const deadline = setTimeout(() => {
    console.error('Smoke test excedió 45 segundos.');
    for (const instance of launchers) void instance.close();
    app.exit(1);
  }, 45000);
  try {
    await check('web real en WebContentsView, aislamiento, título e interacción', async () => {
      const instance = launcher();
      await instance.start([await fixture('demo.app.json', basic)]);
      assert.equal(instance.state, 'running', instance.error?.message);
      assert.equal(instance.window.getTitle(), basic.title);
      assert.equal(instance.window.isMenuBarVisible(), false);
      const contents = instance.webView.webContents;
      const preferences = contents.getLastWebPreferences();
      assert.equal(preferences.contextIsolation, true);
      assert.equal(preferences.nodeIntegration, false);
      assert.equal(preferences.sandbox, true);
      assert.ok(!preferences.preload);
      assert.equal(await contents.executeJavaScript('typeof require'), 'undefined');
      assert.equal(await contents.executeJavaScript('document.getElementById("increment").click(); document.getElementById("count").textContent'), '1 clics');
      instance.window.showInactive();
      await delay(300);
      await capture(contents, 'demo');
      const port = instance.server.port;
      const pid = instance.server.child.pid;
      // Usa el evento real de cierre de BrowserWindow.
      instance.window.close();
      await instance.closePromise;
      assert.equal(await isPortOpen(port), false);
      assert.throws(() => process.kill(pid, 0));
    });
    await check('falta de argumento produce ventana de error', async () => {
      const instance = launcher();
      await instance.start([]);
      assert.equal(instance.state, 'error');
      assert.match(await instance.window.webContents.executeJavaScript('document.getElementById("message").textContent'), /Falta el manifiesto/);
      await instance.close();
    });
    await check('JSON inválido produce ventana de error', async () => {
      const instance = launcher();
      await instance.start([await fixture('invalid.app.json', '{')]);
      assert.equal(instance.state, 'error');
      assert.match(instance.error.message, /JSON válido/);
      await instance.close();
    });
    await check('runtime ausente produce causa en pantalla', async () => {
      const instance = launcher();
      await instance.start([await fixture('missing.app.json', { ...basic, command: 'webbox-runtime-inexistente-9752.exe' })]);
      assert.equal(instance.state, 'error');
      assert.match(await instance.window.webContents.executeJavaScript('document.getElementById("message").textContent'), /runtime.*instalado/);
      instance.window.showInactive();
      await delay(300);
      await capture(instance.window.webContents, 'error');
      await instance.close();
    });
    await check('timeout muestra error y termina el proceso directo', async () => {
      const instance = launcher();
      await instance.start([await fixture('timeout.app.json', { ...basic, args: ['-e', 'setInterval(() => {}, 1000)'], ready: { type: 'port', timeoutMs: 350 } })]);
      assert.equal(instance.state, 'error');
      assert.match(instance.error.message, /no abrió el puerto/);
      assert.throws(() => process.kill(instance.server.child.pid, 0));
      await instance.close();
    });
    await check('salida 0 prematura muestra diagnóstico', async () => {
      const instance = launcher();
      await instance.start([await fixture('exited.app.json', { ...basic, args: ['-e', 'console.error("fallo de ejemplo · España"); process.exit(0)'] })]);
      assert.equal(instance.state, 'error');
      assert.match(instance.error.message, /código 0.*segundo plano/);
      assert.match(await instance.window.webContents.executeJavaScript('document.getElementById("details").textContent'), /fallo de ejemplo · España/);
      await instance.close();
    });

    await check('carga HTTP bloqueada tiene timeout y termina el servidor', async () => {
      const instance = launcher();
      await instance.start([await fixture('http-blocked.app.json', {
        ...basic, args: ['-e', 'require("node:net").createServer(s=>s.on("error",()=>{})).listen(Number(process.env.PORT),"127.0.0.1")'],
        ready: { type: 'port', timeoutMs: 1000 }
      })]);
      assert.equal(instance.state, 'error');
      assert.match(instance.error.message, /página no terminó de cargar/);
      assert.throws(() => process.kill(instance.server.child.pid, 0));
      await instance.close();
    });
    await check('cerrar durante la carga cancela la operación', async () => {
      const instance = launcher();
      const pending = instance.start([await fixture('close-loading.app.json', {
        ...basic, args: ['-e', 'require("node:net").createServer(s=>s.on("error",()=>{})).listen(Number(process.env.PORT),"127.0.0.1")']
      })]);
      await waitFor(() => instance.server?.ready && instance.webView);
      instance.window.close();
      await instance.closePromise;
      await pending;
      assert.equal(instance.state, 'closed');
      assert.throws(() => process.kill(instance.server.child.pid, 0));
    });
    await check('caída del renderer muestra error y permite recargar desde la interfaz', async () => {
      const instance = launcher();
      await instance.start([await fixture('renderer.app.json', basic)]);
      const pid = instance.server.child.pid;
      instance.webView.webContents.forcefullyCrashRenderer();
      await waitFor(async () => instance.state === 'error' && await instance.window.webContents.executeJavaScript('!document.getElementById("reload").hidden'));
      assert.match(await instance.window.webContents.executeJavaScript('document.getElementById("label").textContent'), /vista web/);
      instance.window.showInactive();
      await delay(300);
      await capture(instance.window.webContents, 'renderer-error');
      await instance.window.webContents.executeJavaScript('document.getElementById("reload").click(); undefined;');
      await waitFor(() => instance.state === 'running');
      assert.equal(instance.server.child.pid, pid);
      assert.equal(instance.webView.webContents.isCrashed(), false);
      assert.equal(await instance.webView.webContents.executeJavaScript('typeof webboxStatus'), 'undefined');
      await instance.close();
    });
    await check('vista sin respuesta muestra recuperación', async () => {
      const instance = launcher();
      await instance.start([await fixture('unresponsive.app.json', basic)]);
      const rendererPid = instance.webView.webContents.getOSProcessId();
      instance.webView.webContents.emit('unresponsive');
      await waitFor(async () => instance.state === 'error' && /no responde/.test(await instance.window.webContents.executeJavaScript('document.getElementById("message").textContent')));
      await instance.reloadWebPage();
      assert.equal(instance.state, 'running');
      assert.notEqual(instance.webView.webContents.getOSProcessId(), rendererPid);
      await instance.close();
    });
    await check('salida después del arranque muestra servidor detenido', async () => {
      const instance = launcher();
      await instance.start([await fixture('down.app.json', basic)]);
      instance.server.child.kill();
      await waitFor(async () => instance.state === 'error' && /servidor se ha detenido/.test(await instance.window.webContents.executeJavaScript('document.getElementById("label").textContent')));
      assert.equal(await instance.window.webContents.executeJavaScript('document.getElementById("reload").hidden'), true);
      await instance.close();
    });
    await check('navegación local permitida y enlaces, redirecciones y ventanas externos controlados', async () => {
      let requests = 0;
      const other = http.createServer((_request, response) => { requests++; response.end('EXTERNAL'); });
      await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
      const externalUrl = 'http://127.0.0.1:' + other.address().port + '/';
      const opened = [];
      const instance = launcher({ openExternal: async url => opened.push(url) });
      try {
        const code = 'const http=require("node:http");http.createServer((q,s)=>{if(q.url==="/redirect"){s.writeHead(302,{Location:'
          + JSON.stringify(externalUrl) + '});s.end();}else{s.end("<!doctype html><h1>LOCAL</h1>");}}).listen(Number(process.env.PORT),"127.0.0.1");';
        await instance.start([await fixture('navigation.app.json', { ...basic, args: ['-e', code] })]);
        const contents = instance.webView.webContents;
        const navigate = url => contents.executeJavaScript('location.href=' + JSON.stringify(url) + '; undefined;');
        const local = instance.url + 'next';
        await navigate(local);
        await waitFor(() => contents.getURL() === local && !contents.isLoading());
        await navigate(externalUrl);
        await waitFor(() => opened.length === 1);
        assert.equal(contents.getURL(), local);
        await navigate(instance.url + 'redirect');
        await waitFor(() => opened.length === 2);
        assert.notEqual(contents.getURL(), externalUrl);
        await contents.executeJavaScript('window.open(' + JSON.stringify(externalUrl) + '); undefined;');
        await waitFor(() => opened.length === 3);
        await contents.executeJavaScript('window.open("file:///C:/not-allowed"); undefined;');
        await delay(100);
        assert.deepEqual(opened, [externalUrl, externalUrl, externalUrl]);
        assert.equal(requests, 0);
        // Un iframe externo tampoco debe abrir un navegador ni cargar ese origen.
        await contents.executeJavaScript('const frame=document.createElement("iframe");frame.src=' + JSON.stringify(externalUrl) + ';document.body.append(frame); undefined;');
        await delay(150);
        assert.equal(requests, 0);
        assert.equal(opened.length, 3);
      } finally {
        await instance.close();
        await new Promise(resolve => other.close(resolve));
      }
    });
    await check('sesiones por nombre y permisos denegados', async () => {
      const first = launcher();
      const second = launcher();
      try {
        await first.start([await fixture('session-a.app.json', { ...basic, name: 'Smoke A ' + process.env.WEBBOX_TEST_RUN_ID })]);
        await second.start([await fixture('session-b.app.json', { ...basic, name: 'Smoke B ' + process.env.WEBBOX_TEST_RUN_ID })]);
        assert.notEqual(first.profileDirectory, second.profileDirectory);
        assert.notEqual(first.webSession, second.webSession);
        await first.webSession.cookies.set({ url: first.url, name: 'isolated', value: 'only-a' });
        assert.equal((await second.webSession.cookies.get({ url: second.url, name: 'isolated' })).length, 0);
        assert.equal(await first.webView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(p=>p.state)'), 'denied');
        assert.equal(await first.webView.webContents.executeJavaScript('Notification.requestPermission()'), 'denied');
        assert.equal(await second.webView.webContents.executeJavaScript('document.getElementById("increment").click(); document.getElementById("count").textContent'), '1 clics');
      } finally {
        await first.close();
        await second.close();
      }
    });

  } catch (error) {
    exitCode = 1;
    console.error(error);
    report.push({ name: 'failure', result: 'failed', message: error.stack });
  } finally {
    for (const instance of launchers) await instance.close();
    clearTimeout(deadline);
    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ date: new Date().toISOString(), runId: process.env.WEBBOX_TEST_RUN_ID, platform: process.platform, electron: process.versions.electron, node: process.versions.node, windows: process.getSystemVersion(), arch: process.arch, scaleFactor: screen.getPrimaryDisplay().scaleFactor, captures, checks: report }, null, 2));
    app.exit(exitCode);
  }
});
