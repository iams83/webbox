'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { readManifest } = require('../src/manifest');
const { LocalServer, isPortOpen } = require('../src/server');
const { relatedProcesses } = require('../src/processes');
const { resolveRuntime } = require('../src/runtimes');

async function fixture(t, extra = {}, files = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'WebBox hito2 España '));
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(directory, name), text);
  const filename = path.join(directory, 'app.app.json');
  await fs.writeFile(filename, JSON.stringify({ name: 'Hito2', command: process.execPath, ready: { type: 'port', timeoutMs: 15000 }, ...extra }));
  const server = new LocalServer(await readManifest(filename));
  const start = server.start.bind(server);
  server.start = async () => {
    try { return await start(); }
    catch (error) { error.message += '\n' + server.tail(); throw error; }
  };
  t.after(async () => {
    try { await server.stop(); }
    finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  return server;
}

const serve = 'require("node:http").createServer((q,s)=>s.end("HITO2")).listen(Number(process.env.PORT),"127.0.0.1")';
async function waitFor(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(25); }
  throw new Error('Condición no cumplida.');
}

test('stdout conserva fragmentos UTF-8 y exige también un listener propio', async t => {
  const server = await fixture(t, { ready: { type: 'stdout', pattern: 'READY España', timeoutMs: 5000 }, args: ['-e', `
    process.stdout.write('REA');setTimeout(()=>process.stdout.write('DY España'),80);
    setTimeout(()=>{${serve}},400);
  `] });
  const url = await server.start();
  assert.equal(await (await fetch(url)).text(), 'HITO2');
  assert.match(server.tail(), /REA[\s\S]*DY España/);
});

test('stderr no satisface readiness stdout y el timeout elimina el proceso', async t => {
  const server = await fixture(t, { ready: { type: 'stdout', pattern: 'READY', timeoutMs: 600 }, args: ['-e', `console.error('READY');${serve}`] });
  await assert.rejects(server.start(), /patrón stdout/);
  assert.equal(await isPortOpen(server.port), false);
});

test('una regexp costosa se cancela sin bloquear el launcher', async t => {
  const server = await fixture(t, { ready: { type: 'stdout', pattern: '(a+)+$', timeoutMs: 600 }, args: ['-e', `process.stdout.write('a'.repeat(32000)+'!');${serve}`] });
  const before = Date.now();
  await assert.rejects(server.start(), /patrón stdout/);
  // El worker se cancela; el cierre incluye ahora consultar/confirmar CIM.
  assert.ok(Date.now() - before < 7500);
  assert.equal(await isPortOpen(server.port), false);
});

test('arg y placeholder entregan el puerto sin imponer PORT', async t => {
  for (const mode of ['arg', 'placeholder']) {
    const args = ['server.js', ...(mode === 'placeholder' ? ['{PORT}'] : [])];
    const server = await fixture(t, { port: { mode }, args }, { 'server.js': `
      const port=Number(process.argv[${mode === 'arg' ? 3 : 2}]);
      if(process.env.PORT!==undefined)throw new Error('PORT heredado');
      require('node:http').createServer((q,s)=>s.end(String(port))).listen(port,'127.0.0.1');
    ` });
    const url = await server.start();
    assert.equal(await (await fetch(url)).text(), String(server.port));
    await server.stop();
  }
});

test('npm lanza descendientes y cierra el servidor y su puerto', async t => {
  const server = await fixture(t, { command: 'npm', args: ['run', 'serve'] }, {
    'package.json': JSON.stringify({ scripts: { serve: 'node server.js' } }), 'server.js': serve
  });
  const url = await server.start();
  assert.notEqual(server.listenerPid, server.child.pid);
  assert.equal(await (await fetch(url)).text(), 'HITO2');
  const pid = server.listenerPid;
  await server.stop();
  assert.throws(() => process.kill(pid, 0));
  assert.equal(await isPortOpen(server.port), false);
});

test('npx local y npm.cmd se resuelven sin shell', async t => {
  for (const command of ['npx', 'npm.cmd']) {
    const server = await fixture(t, { command, args: command === 'npx' ? ['--no-install', '--call', 'node server.js'] : ['run', 'serve'] }, {
      'package.json': JSON.stringify({ scripts: { serve: 'node server.js' } }), 'server.js': serve
    });
    await server.start();
    assert.match(server.runtime.command, /node\.exe$/i);
    assert.equal(server.runtime.windowsVerbatimArguments, undefined);
    await server.stop();
    assert.equal(await isPortOpen(server.port), false);
  }
});

test('.cmd con ruta y argumentos con espacios/acentos funciona; metacaracteres fallan', async t => {
  const server = await fixture(t, { command: './servidor España.cmd', args: ['valor España con espacios'] }, {
    'servidor España.cmd': '@echo off\r\n"' + process.execPath + '" "%~dp0server.js" %*\r\n',
    'server.js': 'console.log(process.argv[2]);' + serve
  });
  await server.start();
  assert.match(server.tail(), /valor España con espacios/);
  await server.stop();
  for (const value of ['x&echo injected', '%PATH%', 'a"b', 'x\ny', 'x|y', 'x^y']) {
    const bad = await fixture(t, { command: './safe.cmd', args: [value] }, { 'safe.cmd': '@echo off\r\nexit /b 0\r\n' });
    await assert.rejects(bad.start(), /invocación segura/);
    assert.equal(bad.child, null);
  }
});

test('Python real recibe UTF-8 sin buffer y sirve HTTP local', async t => {
  for (const command of ['python', 'py']) {
  const server = await fixture(t, { command, args: ['server.py'], ready: { type: 'stdout', pattern: 'READY España', timeoutMs: 15000 } }, {
    'server.py': `import os\nfrom http.server import HTTPServer, BaseHTTPRequestHandler\nassert os.environ['PYTHONUNBUFFERED']=='1'\nassert os.environ['PYTHONIOENCODING']=='utf-8'\nclass Handler(BaseHTTPRequestHandler):\n def do_GET(self):\n  self.send_response(200)\n  self.end_headers()\n  self.wfile.write('España'.encode('utf-8'))\nserver=HTTPServer(('127.0.0.1',int(os.environ['PORT'])),Handler)\nprint('READY España')\nserver.serve_forever()\n`
  });
  const url = await server.start();
  assert.equal(await (await fetch(url)).text(), 'España');
  assert.match(server.tail(), /Runtime:.*py/i);
  const pid = server.listenerPid;
  await server.stop();
  assert.throws(() => process.kill(pid, 0));
  }
});

test('Python ausente prueba py, y ambos ausentes muestran instrucciones', async t => {
  const controller = new AbortController();
  const fallback = await resolveRuntime('C:\\runtime-inexistente\\python.exe', [], { ...process.env }, process.cwd(), controller.signal);
  assert.match(fallback.command, /py\.exe$/i);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'WebBox runtimes '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(resolveRuntime('python', [], { PATH: directory }, directory, controller.signal), /Instala Python.*Microsoft Store/);
  await fs.mkdir(path.join(directory, 'WindowsApps'));
  await fs.writeFile(path.join(directory, 'WindowsApps', 'python.exe'), 'alias');
  await assert.rejects(resolveRuntime('python', [], { PATH: path.join(directory, 'WindowsApps') }, directory, controller.signal), /Instala Python/);
  const invalidPython = path.join(directory, 'python.exe');
  await fs.copyFile(process.execPath, invalidPython);
  const versionFallback = await resolveRuntime(invalidPython, [], { ...process.env }, directory, controller.signal);
  assert.match(versionFallback.command, /py\.exe$/i);
});

const detachedCode = `
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['-e',${JSON.stringify(serve)}],{detached:true,windowsHide:true,stdio:'ignore'});
  child.unref();
`;
test('detached acepta salida 0, sirve la web y termina el árbol por puerto', async t => {
  const server = await fixture(t, { detached: true, args: ['-e', detachedCode] });
  const url = await server.start();
  assert.equal(server.child.exitCode, 0);
  assert.equal(await (await fetch(url)).text(), 'HITO2');
  const pid = server.listenerPid;
  await server.stop();
  assert.throws(() => process.kill(pid, 0));
  assert.equal(await isPortOpen(server.port), false);
});

test('detached supervisa el puerto después de salir el proceso inicial', async t => {
  const server = await fixture(t, { detached: true, args: ['-e', detachedCode] });
  await server.start();
  let down;
  server.once('down', error => { down = error; });
  process.kill(server.listenerPid);
  await waitFor(() => down);
  assert.match(down.message, /detached dejó de escuchar/);
});

test('detached sin listener agota el plazo y salida no cero sigue siendo fallo', async t => {
  for (const code of [0, 7]) {
    const server = await fixture(t, { detached: true, ready: { type: 'port', timeoutMs: 600 }, args: ['-e', `process.exit(${code})`] });
    await assert.rejects(server.start(), code === 0 ? /no abrió el puerto/ : /código 7/);
  }
});

test('cancelar detached después de aparecer el listener lo termina durante readiness HTTP', async t => {
  const code = detachedCode.replace(JSON.stringify(serve), JSON.stringify('require("node:http").createServer((q,s)=>{}).listen(Number(process.env.PORT),"127.0.0.1")'));
  const server = await fixture(t, { detached: true, args: ['-e', code], ready: { type: 'http', path: '/health', timeoutMs: 15000 } });
  const pending = assert.rejects(server.start(), /Arranque cancelado/);
  await waitFor(() => server.listenerPid !== null);
  const pid = server.listenerPid;
  await server.stop();
  await pending;
  assert.throws(() => process.kill(pid, 0));
});

test('detached rechaza un puerto ajeno y nunca lo termina', async t => {
  const other = http.createServer((_q,s)=>s.end('FOREIGN'));
  t.after(() => new Promise(resolve => other.close(resolve)));
  const server = await fixture(t, { detached: true, args: ['-e', 'process.exit(0)'] });
  const select = server.selectPort.bind(server);
  server.selectPort = async () => {
    const port = await select();
    await new Promise(resolve => other.listen(port, '127.0.0.1', resolve));
    return port;
  };
  // Limitar a un puerto fijo ocupado después de la primera reserva.
  const original = server.selectPort;
  let once = false;
  server.selectPort = async () => {
    if (once) throw Object.assign(new Error('ocupado'), { code: 'EADDRINUSE' });
    once = true; return original();
  };
  await assert.rejects(server.start(), /otro proceso|tres reintentos/);
  await server.stop();
  assert.equal(await isPortOpen(other.address().port), true);
});

test('el árbol usa fechas y no adopta hijos de un PID reutilizado después de su salida', () => {
  const rows = [
    { pid: 10, parent: 1, born: 400 }, { pid: 20, parent: 10, born: 150 },
    { pid: 30, parent: 10, born: 450 }, { pid: 40, parent: 20, born: 300 }
  ];
  assert.deepEqual(relatedProcesses(rows, { pid: 10, born: 100, until: 200 }).map(row => row.pid), [20, 40]);
});
