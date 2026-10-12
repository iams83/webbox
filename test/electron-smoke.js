'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, screen, dialog, clipboard } = require('electron');
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
    console.error('Smoke test excedió 180 segundos.');
    for (const instance of launchers) void instance.close();
    app.exit(1);
  }, 180000);
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

    await check('readiness HTTP mantiene carga hasta que la aplicación responde 2xx', async () => {
      const instance = launcher();
      const pending = instance.start([await fixture('http-ready.app.json', {
        ...basic, ready: { type: 'http', path: '/health', timeoutMs: 5000 },
        args: ['-e', `
          const http=require('node:http');let ready=false;
          http.createServer((q,s)=>{
            if(q.url==='/health'){console.log('health='+ready);s.writeHead(ready?204:503);s.end();}
            else{s.end('<!doctype html><h1>HTTP READY</h1>');}
          }).listen(Number(process.env.PORT),'127.0.0.1',()=>setTimeout(()=>{ready=true;},600));
        `]
      })]);
      await waitFor(() => /health=false/.test(instance.server?.tail() ?? ''));
      assert.equal(instance.state, 'starting');
      assert.equal(instance.webView, null);
      await pending;
      assert.equal(instance.state, 'running', instance.error?.message);
      assert.equal(await instance.webView.webContents.executeJavaScript('document.querySelector("h1").textContent'), 'HTTP READY');
      await instance.close();
    });
    await check('timeout de readiness HTTP muestra causa y termina el servidor', async () => {
      const instance = launcher();
      await instance.start([await fixture('http-ready-timeout.app.json', {
        ...basic, ready: { type: 'http', path: '/health', timeoutMs: 1200 },
        args: ['-e', 'require("node:http").createServer((q,s)=>{s.writeHead(503);s.end();}).listen(Number(process.env.PORT),"127.0.0.1")']
      })]);
      assert.equal(instance.state, 'error');
      assert.match(await instance.window.webContents.executeJavaScript('document.getElementById("message").textContent'), /HTTP.*HTTP 503/);
      assert.equal(instance.webView, null);
      assert.throws(() => process.kill(instance.server.child.pid, 0));
      await instance.close();
    });
    await check('cerrar durante readiness HTTP cancela y termina el servidor', async () => {
      const instance = launcher();
      const pending = instance.start([await fixture('http-ready-close.app.json', {
        ...basic, ready: { type: 'http', path: '/health', timeoutMs: 10000 },
        args: ['-e', 'require("node:http").createServer((q,s)=>{console.log("REQUEST");}).listen(Number(process.env.PORT),"127.0.0.1")']
      })]);
      await waitFor(() => /REQUEST/.test(instance.server?.tail() ?? ''));
      instance.window.close();
      await instance.closePromise;
      await pending;
      assert.equal(instance.state, 'closed');
      assert.equal(instance.webView, null);
      assert.throws(() => process.kill(instance.server.child.pid, 0));
    });
    await check('puerto ocupado muestra error sin cargar el servicio existente', async () => {
      let requests = 0;
      const other = http.createServer((_q,s) => { requests++; s.end('EXTERNAL'); });
      await new Promise(resolve => other.listen(0,'127.0.0.1',resolve));
      const instance = launcher();
      try {
        await instance.start([await fixture('port-busy.app.json', { ...basic, port: { fixed: other.address().port } })]);
        assert.equal(instance.state, 'error');
        assert.match(await instance.window.webContents.executeJavaScript('document.getElementById("message").textContent'), /puerto fijo.*ocupado/);
        assert.equal(instance.server.child, null);
        assert.equal(instance.webView, null);
        assert.equal(requests, 0);
      } finally {
        await instance.close();
        await new Promise(resolve => other.close(resolve));
      }
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

    await check('Python real y readiness stdout cargan la web', async () => {
      const instance = launcher();
      await instance.start([await fixture('python.app.json', {
        ...basic, command: 'python', cwd: path.join(__dirname, '../examples/python'), args: ['server.py'],
        ready: { type: 'stdout', pattern: 'READY España', timeoutMs: 15000 }
      })]);
      assert.equal(instance.state, 'running', instance.error?.message);
      assert.equal(await instance.webView.webContents.executeJavaScript('document.querySelector("h1").textContent'), 'Tu web, en una ventana.');
      await instance.close();
      assert.equal(await isPortOpen(instance.server.port), false);
    });
    await check('npm carga la web y cierra el servidor descendiente', async () => {
      const instance = launcher();
      await instance.start([await fixture('npm.app.json', {
        ...basic, command: 'npm', cwd: path.join(__dirname, '../examples/npm'), args: ['run', 'serve'],
        ready: { type: 'http', path: '/', timeoutMs: 15000 }
      })]);
      assert.equal(instance.state, 'running', instance.error?.message);
      const pid = instance.server.listenerPid;
      assert.notEqual(pid, instance.server.child.pid);
      instance.window.close();
      await instance.closePromise;
      assert.throws(() => process.kill(pid, 0));
    });
    await check('detached carga la web y cierra por puerto', async () => {
      const instance = launcher();
      await instance.start([await fixture('detached.app.json', {
        ...basic, cwd: path.join(__dirname, '../examples/detached'), args: ['start.js'], detached: true,
        ready: { type: 'http', path: '/', timeoutMs: 15000 }
      })]);
      assert.equal(instance.state, 'running', instance.error?.message);
      assert.equal(instance.server.child.exitCode, 0);
      const pid = instance.server.listenerPid;
      await instance.close();
      assert.throws(() => process.kill(pid, 0));
    });
    await check('reintentar un arranque fallido conserva la ventana y permite ver log y salir', async () => {
      const other = http.createServer((_q,s) => s.end('BUSY'));
      await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
      const instance = launcher();
      try {
        await instance.start([await fixture('retry.app.json', { ...basic, port: { fixed: other.address().port } })]);
        const window = instance.window;
        assert.equal(instance.state, 'error');
        const contents = window.webContents;
        assert.equal(await contents.executeJavaScript('document.getElementById("retry").hidden'), false);
        await contents.executeJavaScript('document.getElementById("log").click(); undefined;');
        assert.equal(await contents.executeJavaScript('document.getElementById("details").hidden'), true);
        await new Promise(resolve => other.close(resolve));
        await contents.executeJavaScript('document.getElementById("retry").click(); undefined;');
        await waitFor(() => instance.state === 'running');
        assert.equal(instance.window, window);
        instance.server.child.kill();
        await waitFor(async () => instance.state === 'error' && await contents.executeJavaScript('!document.getElementById("exit").hidden'));
        await contents.executeJavaScript('document.getElementById("exit").click(); undefined;');
        await waitFor(() => instance.state === 'closed');
      } finally {
        await instance.close();
        if (other.listening) await new Promise(resolve => other.close(resolve));
      }
    });
    await check('reiniciar tras caída del servidor conserva el perfil y valida el emisor IPC', async () => {
      const instance = launcher();
      await instance.start([await fixture('restart.app.json', basic)]);
      const oldServer = instance.server;
      const profile = instance.profileDirectory;
      oldServer.child.kill();
      await waitFor(async () => instance.state === 'error' && await instance.window.webContents.executeJavaScript('!document.getElementById("retry").hidden'));
      instance.restartHandler({ sender: instance.webView.webContents });
      assert.equal(instance.server, oldServer);
      assert.equal(instance.state, 'error');
      await instance.window.webContents.executeJavaScript('document.getElementById("retry").click(); undefined;');
      await waitFor(() => instance.state === 'running');
      assert.notEqual(instance.server.child.pid, oldServer.child.pid);
      assert.equal(instance.profileDirectory, profile);
      assert.equal(await instance.webView.webContents.executeJavaScript('typeof webboxStatus'), 'undefined');
      await instance.close();
    });

    await check('descargas HTTP y blob conservan bytes UTF-8 y opciones de Guardar', async () => {
      const instance = launcher();
      await instance.start([await fixture('downloads.app.json', basic)]);
      assert.equal(instance.state, 'running', instance.error?.message);
      const contents = instance.webView.webContents;
      const directory = path.join(artifacts, 'descargas España ' + process.env.WEBBOX_TEST_RUN_ID);
      await fs.mkdir(directory, { recursive: true });
      const download = async (script, filename, expected) => {
        let item;
        let handler;
        let timer;
        const done = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Descarga sin finalizar: ' + filename + '; ' + (item ? item.getState() : 'sin will-download'))), 10000);
          handler = (_event, value, source) => {
            try {
              assert.equal(source, contents);
              item = value;
              assert.equal(item.getSaveDialogOptions().title, 'Guardar archivo');
              assert.equal(item.getSaveDialogOptions().buttonLabel, 'Guardar');
              assert.ok(path.isAbsolute(item.getSaveDialogOptions().defaultPath));
              // Solo en el harness: sustituir la elección del usuario para evitar un diálogo bloqueante.
              item.setSavePath(path.join(directory, filename));
              item.once('done', (_event, state) => resolve(state));
            } catch (error) { reject(error); }
          };
          contents.session.once('will-download', handler);
        });
        done.catch(() => {});
        try {
          await contents.executeJavaScript(script, true);
          assert.equal(await done, 'completed');
        } finally { clearTimeout(timer); contents.session.removeListener('will-download', handler); }
        assert.equal(await fs.readFile(item.getSavePath(), 'utf8'), expected);
      };
      await download('document.getElementById("download").click(); undefined;', 'informe España.txt', 'WebBox · España\nArchivo de demostración.\n');
      await download(`
        const blob = new Blob(['Exportación España'], {type:'text/plain'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'exportación.txt';
        a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000); undefined;
      `, 'exportación España.txt', 'Exportación España');
      assert.match(instance.server.tail(), /Descarga completed/);
      await instance.close();
    });
    await check('cancelar una descarga y cerrar durante una transferencia no deja descargas activas', async () => {
      const instance = launcher();
      await instance.start([await fixture('download-cancel.app.json', { ...basic, args: ['-e', `
        require('node:http').createServer((q,s)=>{
          if(q.url==='/slow') { s.writeHead(200,{'Content-Disposition':'attachment; filename="slow.txt"'});
            s.write('inicio'); const timer=setInterval(()=>s.write('datos'),100); s.on('close',()=>clearInterval(timer)); }
          else s.end('<h1>Descargas</h1>');
        }).listen(Number(process.env.PORT),'127.0.0.1');
      `] })]);
      assert.equal(instance.state, 'running', instance.error?.message);
      const contents = instance.webView.webContents;
      const begin = async (cancel, filename) => {
        let item;
        let finished;
        const started = new Promise(resolve => contents.session.once('will-download', (_event, value) => {
          item = value;
          finished = new Promise(done => item.once('done', (_event, state) => done(state)));
          if (cancel) item.cancel();
          else item.setSavePath(path.join(artifacts, filename + '-' + process.env.WEBBOX_TEST_RUN_ID + '.txt'));
          resolve();
        }));
        contents.downloadURL(instance.url + 'slow');
        await started;
        return { item, finished };
      };
      const cancelled = await begin(true, 'cancelled');
      assert.equal(await cancelled.finished, 'cancelled');
      const pending = await begin(false, 'partial');
      await waitFor(() => pending.item.getReceivedBytes() > 0);
      await instance.close();
      assert.equal(await pending.finished, 'cancelled');
      assert.equal(contents.session.listenerCount('will-download'), 0);
    });
    await check('selector de archivo y subida usan Chromium sin exponer rutas ni Node', async () => {
      const instance = launcher();
      await instance.start([await fixture('upload.app.json', basic)]);
      assert.equal(instance.state, 'running', instance.error?.message);
      const contents = instance.webView.webContents;
      const filename = await fixture('archivo España.txt', 'Archivo UTF-8 · España');
      const bytes = (await fs.stat(filename)).size;
      contents.debugger.attach('1.3');
      try {
        await contents.debugger.sendCommand('Page.enable');
        await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
        const chooser = new Promise(resolve => {
          const handler = (_event, method, params) => {
            if (method === 'Page.fileChooserOpened') { contents.debugger.removeListener('message', handler); resolve(params); }
          };
          contents.debugger.on('message', handler);
        });
        await contents.executeJavaScript('document.getElementById("upload").click(); undefined;', true);
        const params = await chooser;
        assert.equal(params.mode, 'selectSingle');
        await contents.debugger.sendCommand('DOM.setFileInputFiles', { files: [filename], backendNodeId: params.backendNodeId });
        await waitFor(async () => (await contents.executeJavaScript('document.getElementById("upload-result").textContent')).includes(bytes + ' bytes recibidos'));
        const value = await contents.executeJavaScript('document.getElementById("upload").value');
        assert.match(value, /fakepath/);
        assert.equal(await contents.executeJavaScript('typeof require + ":" + typeof webboxStatus'), 'undefined:undefined');
      } finally { contents.debugger.detach(); }
      await instance.close();
    });
    await check('alert y confirm se encaminan al diálogo nativo de la ventana', async () => {
      const instance = launcher();
      await instance.start([await fixture('dialogs.app.json', basic)]);
      assert.equal(instance.state, 'running', instance.error?.message);
      const contents = instance.webView.webContents;
      const original = dialog.showMessageBox;
      const calls = [];
      const responses = [0, 1, 0];
      dialog.showMessageBox = async (parent, options) => {
        assert.equal(parent, instance.window);
        calls.push(options);
        return { response: responses.shift(), checkboxChecked: false };
      };
      try {
        await contents.executeJavaScript('document.getElementById("alert").click(); undefined;', true);
        await contents.executeJavaScript('document.getElementById("confirm").click(); undefined;', true);
        assert.equal(await contents.executeJavaScript('document.getElementById("upload-result").textContent'), 'Cancelado.');
        await contents.executeJavaScript('document.getElementById("confirm").click(); undefined;', true);
        assert.equal(await contents.executeJavaScript('document.getElementById("upload-result").textContent'), 'Confirmado.');
        assert.equal(calls.length, 3);
        assert.match(calls[0].message, /España/);
        assert.equal(calls[0].buttons.length, 1);
        assert.equal(calls[1].cancelId, 1);
        assert.match(calls[1].checkboxLabel, /más diálogos/);
      } finally { dialog.showMessageBox = original; }
      await instance.close();
    });
    await check('cerrar la ventana termina el árbol de un ejecutable directo', async () => {
      const instance = launcher();
      await instance.start([await fixture('tree.app.json', { ...basic,
        args: [path.join(__dirname, '../examples/process-tree/server.js')],
        ready: { type: 'http', path: '/pids', timeoutMs: 15000 }
      })]);
      assert.equal(instance.state, 'running', instance.error?.message);
      const info = await (await fetch(new URL('/pids', instance.url))).json();
      assert.equal(info.pids.length, 3);
      instance.window.close();
      await waitFor(() => instance.state === 'closed', 15000);
      for (const pid of info.pids) assert.throws(() => process.kill(pid, 0));
      assert.equal(await isPortOpen(info.port), false);
    });

    await check('F12 alterna web y xterm con foco sin recargar aunque la web capture teclas', async () => {
      const instance = launcher();
      await instance.start([await fixture('log-toggle.app.json', basic)]);
      assert.equal(instance.state, 'running', instance.error?.message);
      await instance.logLoadPromise;
      const web = instance.webView.webContents, log = instance.logView.webContents;
      instance.window.show(); instance.window.focus(); web.focus();
      await web.executeJavaScript(`
        window.marker = 'sin recarga'; window.f12Received = 0;
        document.addEventListener('keydown', e => { if(e.key==='F12') window.f12Received++; e.preventDefault(); e.stopImmediatePropagation(); }, true);
        document.getElementById('increment').click(); undefined;
      `);
      const pid = web.getOSProcessId();
      web.sendInputEvent({ type: 'keyDown', keyCode: 'F12' });
      web.sendInputEvent({ type: 'keyUp', keyCode: 'F12' });
      await waitFor(() => instance.activeView === 'log' && log.isFocused());
      await waitFor(async () => await log.executeJavaScript('!!window.logTerminal && document.getElementById("state").textContent === "Activo"'));
      assert.equal(instance.webView.getVisible(), false);
      assert.equal(await web.executeJavaScript('f12Received'), 0);
      await capture(log, 'log');
      log.sendInputEvent({ type: 'keyDown', keyCode: 'F12' });
      log.sendInputEvent({ type: 'keyUp', keyCode: 'F12' });
      await waitFor(() => instance.activeView === 'content' && web.isFocused());
      assert.equal(web.getOSProcessId(), pid);
      assert.equal(await web.executeJavaScript('marker'), 'sin recarga');
      assert.equal(await web.executeJavaScript('document.getElementById("count").textContent'), '1 clics');
      await instance.close();
    });
    await check('xterm muestra ANSI, limita líneas y permite copiar limpiar y pausar autoscroll', async () => {
      const instance = launcher();
      await instance.start([await fixture('log-actions.app.json', { ...basic, logOnStart: true })]);
      assert.equal(instance.state, 'running', instance.error?.message);
      await instance.logLoadPromise;
      assert.equal(instance.activeView, 'log');
      const log = instance.logView.webContents;
      instance.server.log('stdout', '\x1b[32;1mVERDE España\x1b[0m\n');
      instance.server.log('stderr', 'ERROR de prueba\n');
      const terminalText = 'Array.from({length:logTerminal.buffer.active.length},(_,i)=>logTerminal.buffer.active.getLine(i).translateToString(true)).join("\\n")';
      await waitFor(async () => (await log.executeJavaScript(terminalText)).includes('VERDE España'));
      const color = await log.executeJavaScript(`
        (()=>{const b=logTerminal.buffer.active;for(let i=0;i<b.length;i++){const l=b.getLine(i),c=l.translateToString(true).indexOf('VERDE');if(c>=0)return l.getCell(c).getFgColor();}})()
      `);
      assert.equal(color, 2);
      assert.equal(await log.executeJavaScript('document.querySelector(".legend").getBoundingClientRect().bottom <= innerHeight'), true);
      await capture(log, 'log');
      assert.equal(await log.executeJavaScript('logTerminal.options.disableStdin'), true);
      assert.equal(await log.executeJavaScript('typeof require + ":" + typeof webboxStatus'), 'undefined:undefined');
      const originalClipboard = await clipboard.readText();
      try {
        await log.executeJavaScript('document.getElementById("copy").click(); undefined;');
        await waitFor(async () => (await clipboard.readText()).includes('VERDE España'));
        assert.doesNotMatch(await clipboard.readText(), /\x1b/);
        await log.executeJavaScript('document.getElementById("pause").click(); undefined;');
        instance.server.log('stdout', Array.from({length:10020},(_,i)=>'línea '+i+'\n').join(''));
        await waitFor(async () => (await log.executeJavaScript(terminalText)).includes('línea 10019'), 15000);
        assert.equal(instance.logs.visibleSnapshot().lines.length, 10000);
        const top = await log.executeJavaScript('logTerminal.scrollToTop(); logTerminal.buffer.active.viewportY');
        instance.server.log('stdout', 'final pausado\n');
        await waitFor(async () => (await log.executeJavaScript(terminalText)).includes('final pausado'), 15000);
        assert.equal(await log.executeJavaScript('logTerminal.buffer.active.viewportY'), top);
        await log.executeJavaScript('document.getElementById("pause").click(); undefined;');
        assert.equal(await log.executeJavaScript('logTerminal.buffer.active.viewportY === logTerminal.buffer.active.baseY'), true);
        // La web no puede ejecutar las acciones privilegiadas del visor.
        instance.logActionHandler({sender:instance.webView.webContents}, 'clear');
        assert.equal(instance.logs.visibleSnapshot().lines.length, 10000);
        await log.executeJavaScript('document.getElementById("clear").click(); undefined;');
        await waitFor(() => instance.logs.visibleSnapshot().lines.length === 0);
        await waitFor(async () => !(await log.executeJavaScript(terminalText)).includes('final pausado'));
        instance.server.log('stderr', 'después de limpiar\n');
        await waitFor(async () => (await log.executeJavaScript(terminalText)).includes('después de limpiar'));
      } finally { await clipboard.writeText(originalClipboard); }
      const file = instance.logs.writer.filename;
      await instance.close();
      assert.match(await fs.readFile(file, 'utf8'), /después de limpiar/);
    });
    await check('DevTools solo se abre con debug y Ctrl Shift F12', async () => {
      const normal = launcher();
      await normal.start([await fixture('no-debug.app.json', basic)]);
      const key = contents => { contents.sendInputEvent({type:'keyDown',keyCode:'F12',modifiers:['control','shift']}); contents.sendInputEvent({type:'keyUp',keyCode:'F12',modifiers:['control','shift']}); };
      key(normal.webView.webContents);
      await delay(100);
      assert.equal(normal.webView.webContents.isDevToolsOpened(), false);
      assert.equal(normal.activeView, 'content');
      await normal.close();
      const debug = launcher();
      await debug.start([await fixture('debug.app.json', basic), '--debug']);
      assert.equal(debug.state, 'running', debug.error?.message);
      assert.equal(debug.options.debug, true);
      debug.window.show(); debug.window.focus(); debug.webView.webContents.focus();
      await waitFor(() => debug.webView.webContents.isFocused());
      key(debug.webView.webContents);
      await waitFor(() => debug.webView.webContents.isDevToolsOpened());
      debug.webView.webContents.closeDevTools();
      assert.equal(debug.activeView, 'content');
      await debug.close();
    });
    await check('el log conserva salidas y estado durante caída y reinicio', async () => {
      const instance = launcher();
      await instance.start([await fixture('log-restart.app.json', { ...basic, logOnStart: true })]);
      const view = instance.logView;
      instance.server.log('stderr', 'antes del reinicio\n');
      instance.server.child.kill();
      await waitFor(() => instance.state === 'error');
      await waitFor(async () => await view.webContents.executeJavaScript('document.getElementById("state").textContent === "Caído"'));
      await instance.restartServer();
      assert.equal(instance.state, 'running', instance.error?.message);
      assert.equal(instance.logView, view);
      assert.equal(instance.activeView, 'log');
      assert.match(instance.logs.text(), /antes del reinicio/);
      await waitFor(async () => await view.webContents.executeJavaScript('document.getElementById("state").textContent === "Activo"'));
      await instance.close();
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
