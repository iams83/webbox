'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { readManifest } = require('../src/manifest');
const { LocalServer, isPortOpen, reservePort } = require('../src/server');

async function example() {
  const manifest = await readManifest(path.join(__dirname, '../examples/node/app.app.json'));
  manifest.command = process.execPath;
  return manifest;
}

test('arranca un servidor real, entrega HTML UTF-8 y cierra el proceso directo', async t => {
  const server = new LocalServer(await example());
  t.after(() => server.stop());
  const url = await server.start();
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Tu web, en una ventana/);
  assert.match(server.tail(), /España/);
  await server.stop();
  assert.equal(await isPortOpen(server.port), false);
  assert.ok(server.child.exitCode !== null || server.child.signalCode !== null);
});

test('runtime inexistente y salida prematura se distinguen de timeout', async t => {
  const missing = new LocalServer({ ...await example(), command: 'webbox-runtime-inexistente-9752.exe' });
  t.after(() => missing.stop());
  await assert.rejects(missing.start(), /runtime.*instalado/);
  assert.equal(missing.attempts, 1);
  await missing.stop();
  const exited = new LocalServer({ ...await example(), args: ['-e', 'process.exit(0)'] });
  t.after(() => exited.stop());
  await assert.rejects(exited.start(), /código 0.*segundo plano/);
  assert.equal(exited.attempts, 1);
});


test('el cierre tiene un límite incluso si el sistema no termina el proceso', async () => {
  const server = new LocalServer({});
  // Simula solo el cierre directo; no consultar ni terminar el PID ficticio.
  server.terminateTree = async () => {};
  server.exitPromise = new Promise(() => {});
  let forced = false;
  let streamsClosed = 0;
  server.child = {
    pid: 123, exitCode: null, signalCode: null,
    kill: signal => { if (signal === 'SIGKILL') forced = true; return false; },
    stdout: { destroy: () => streamsClosed++ }, stderr: { destroy: () => streamsClosed++ }
  };
  await assert.rejects(server.stopDirectChild(10), /No se pudo confirmar el cierre.*123.*20 ms/);
  assert.equal(forced, true);
  assert.equal(streamsClosed, 2);
});

test('timeout cancela un servidor que no abre el puerto', async t => {
  const server = new LocalServer({ ...await example(), args: ['-e', 'setInterval(() => {}, 1000)'], ready: { timeoutMs: 350 } });
  t.after(() => server.stop());
  await assert.rejects(server.start(), /no abrió el puerto/);
  await server.stop();
  assert.ok(server.child.exitCode !== null || server.child.signalCode !== null);
});

async function listen(t, server, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error('La condición no se cumplió.');
}

async function httpExample(ready, code) {
  return { ...await example(), args: ['-e', code], ready: { type: 'http', path: '/health', timeoutMs: 5000, ...ready } };
}

test('HTTP espera una ruta de salud 2xx aunque el puerto y la página ya respondan', async t => {
  const server = new LocalServer(await httpExample({}, `
    const http = require('node:http'); let ready = false;
    http.createServer((q, s) => {
      if (q.url === '/health') { console.log('health=' + ready); s.writeHead(ready ? 204 : 503); s.end(); }
      else s.end('APP');
    }).listen(Number(process.env.PORT), '127.0.0.1', () => setTimeout(() => { ready = true; }, 500));
  `));
  t.after(() => server.stop());
  const url = await server.start();
  assert.match(server.tail(), /health=false/);
  assert.match(server.tail(), /health=true/);
  assert.equal(await (await fetch(url)).text(), 'APP');
  assert.equal(server.attempts, 1);
});

test('HTTP codifica espacios y acentos en la ruta', async t => {
  const server = new LocalServer(await httpExample({ path: '/salud España?modo=rápido' }, `
    require('node:http').createServer((q, s) => {
      console.log(q.url); s.writeHead(q.url === '/salud%20Espa%C3%B1a?modo=r%C3%A1pido' ? 200 : 404); s.end();
    }).listen(Number(process.env.PORT), '127.0.0.1');
  `));
  t.after(() => server.stop());
  await server.start();
  assert.equal(server.ready, true);
});

test('HTTP no sigue redirecciones y agota el plazo sin visitar otro origen', async t => {
  let requests = 0;
  const externalPort = await listen(t, http.createServer((_q, s) => { requests++; s.end('EXTERNAL'); }));
  const server = new LocalServer(await httpExample({ timeoutMs: 1200 }, `
    require('node:http').createServer((q, s) => {
      s.writeHead(302, { Location: 'http://127.0.0.1:${externalPort}/' }); s.end();
    }).listen(Number(process.env.PORT), '127.0.0.1');
  `));
  t.after(() => server.stop());
  await assert.rejects(server.start(), /no estuvo listo por HTTP.*HTTP 302/);
  assert.equal(requests, 0);
  assert.equal(server.ready, false);
  assert.equal(await isPortOpen(server.port), false);
  assert.equal(server.attempts, 1);
});

test('HTTP 503 persistente informa el estado y limpia el proceso al fallar', async t => {
  const server = new LocalServer(await httpExample({ timeoutMs: 1000 }, `
    require('node:http').createServer((q, s) => { s.writeHead(503); s.end(); }).listen(Number(process.env.PORT), '127.0.0.1');
  `));
  t.after(() => server.stop());
  await assert.rejects(server.start(), /no estuvo listo por HTTP.*HTTP 503/);
  assert.ok(server.child.exitCode !== null || server.child.signalCode !== null);
  assert.equal(await isPortOpen(server.port), false);
});

test('cerrar durante una petición HTTP sin cabeceras cancela y termina el servidor', async t => {
  const server = new LocalServer(await httpExample({}, `
    require('node:http').createServer((q, s) => { console.log('REQUEST'); }).listen(Number(process.env.PORT), '127.0.0.1');
  `));
  t.after(() => server.stop());
  const pending = server.start();
  const rejected = assert.rejects(pending, /Arranque cancelado/);
  await waitFor(() => /REQUEST/.test(server.tail()));
  const before = Date.now();
  const closing = server.stop();
  assert.equal(server.stop(), closing);
  assert.equal(server.startController.signal.aborted, true);
  await closing;
  await rejected;
  // La cancelación es inmediata; su promesa incluye el cierre CIM/árbol/pipes.
  assert.ok(Date.now() - before < 12500);
  assert.equal(await isPortOpen(server.port), false);
});

test('un servidor que no envía cabeceras HTTP termina al agotar el plazo total', async t => {
  const server = new LocalServer(await httpExample({ timeoutMs: 1100 }, `
    require('node:http').createServer((q, s) => {}).listen(Number(process.env.PORT), '127.0.0.1');
  `));
  t.after(() => server.stop());
  await assert.rejects(server.start(), /no estuvo listo por HTTP.*sin respuesta HTTP/);
  assert.equal(await isPortOpen(server.port), false);
});

test('puerto fijo se transmite al servidor y a los placeholders', async t => {
  const manifest = await example();
  const fixed = await reservePort();
  const server = new LocalServer({ ...manifest, port: { ...manifest.port, fixed },
    env: { CHECK_PORT: '{PORT}' }, args: ['-e', `
      console.log(process.env.CHECK_PORT + ':' + process.argv[1]);
      require('node:http').createServer((q,s)=>s.end('FIXED')).listen(Number(process.env.PORT),'127.0.0.1');
    `, '{PORT}'] });
  t.after(() => server.stop());
  const url = await server.start();
  assert.equal(server.port, fixed);
  assert.match(server.tail(), new RegExp(fixed + ':' + fixed));
  assert.equal(await (await fetch(url)).text(), 'FIXED');
});

test('puerto fijo ocupado no lanza un proceso ni envía peticiones al servicio existente', async t => {
  let requests = 0;
  const fixed = await listen(t, http.createServer((_q, s) => { requests++; s.end('EXISTING'); }));
  const manifest = await httpExample({}, 'process.exit(99)');
  const server = new LocalServer({ ...manifest, port: { ...manifest.port, fixed } });
  t.after(() => server.stop());
  await assert.rejects(server.start(), /puerto fijo.*ocupado.*tres reintentos/);
  assert.equal(server.child, null);
  assert.equal(requests, 0);
  assert.equal(await isPortOpen(fixed), true);
});

test('rango inclusivo omite puertos ocupados y falla claramente si se agota', async t => {
  const first = await listen(t, http.createServer((_q, s) => s.end('BUSY')));
  if (first === 65535) throw new Error('El puerto de prueba no permite probar un rango de dos puertos.');
  // Busca un extremo superior disponible para que el rango tenga un puerto libre real.
  const last = await reservePort(first + 1);
  const manifest = await example();
  const server = new LocalServer({ ...manifest, port: { ...manifest.port, range: [first, last] } });
  t.after(() => server.stop());
  await server.start();
  assert.equal(server.port, last);
  const exhausted = new LocalServer({ ...manifest, port: { ...manifest.port, range: [first, last] } });
  t.after(() => exhausted.stop());
  await assert.rejects(exhausted.start(), /No hay puertos libres en el rango.*tres reintentos/);
  assert.equal(exhausted.child, null);
});

test('un servicio que ocupa el puerto después de la reserva no se acepta como propio y se reintenta', async t => {
  for (const type of ['port', 'http']) {
    let requests = 0;
    const other = http.createServer((_q, s) => { requests++; s.end('FOREIGN'); });
    const server = new LocalServer(await httpExample({ type }, `
      setTimeout(() => require('node:http').createServer((q,s)=>s.end('OWN')).listen(Number(process.env.PORT),'127.0.0.1'), 200);
    `));
    t.after(() => server.stop());
    const select = server.selectPort.bind(server);
    let stolenPort;
    server.selectPort = async () => {
      const port = await select();
      if (!stolenPort) { stolenPort = port; await listen(t, other, port); }
      return port;
    };
    const pids = [];
    const spawn = server.spawnServer.bind(server);
    server.spawnServer = () => { spawn(); pids.push(server.child.pid); };
    const url = await server.start();
    assert.equal(server.attempts, 2);
    assert.notEqual(server.port, stolenPort);
    assert.equal(requests, 0);
    assert.match(server.tail(), /otro proceso.*Reintento 1\/3/);
    assert.throws(() => process.kill(pids[0], 0));
    assert.equal(await (await fetch(url)).text(), 'OWN');
    await server.stop();
    assert.equal(await isPortOpen(stolenPort), true);
  }
});

test('un conflicto repetido termina tras el intento inicial y tres reintentos', async t => {
  const server = new LocalServer(await example());
  t.after(() => server.stop());
  const select = server.selectPort.bind(server);
  server.selectPort = async () => {
    const port = await select();
    await listen(t, http.createServer((_q, s) => s.end('FOREIGN')), port);
    return port;
  };
  await assert.rejects(server.start(), /tres reintentos/);
  assert.equal(server.attempts, 4);
  assert.ok(server.child.exitCode !== null || server.child.signalCode !== null);
});

test('EADDRINUSE del runtime reintenta aunque el proceso salga antes de comprobar el puerto', async t => {
  const manifest = await example();
  const server = new LocalServer({ ...manifest, args: ['-e', 'console.error("EADDRINUSE"); process.exit(1)'] });
  t.after(() => server.stop());
  await assert.rejects(server.start(), /tres reintentos/);
  assert.equal(server.attempts, 4);
});

test('cerrar durante la selección de puerto impide lanzar un proceso tardío', async t => {
  const server = new LocalServer(await example());
  t.after(() => server.stop());
  let release;
  server.selectPort = () => new Promise(resolve => { release = resolve; });
  const rejected = assert.rejects(server.start(), /Arranque cancelado/);
  const closing = server.stop();
  release(3000);
  await closing;
  await rejected;
  assert.equal(server.child, null);
});

test('los reintentos comparten el plazo de arranque y no lo reinician', async t => {
  const manifest = await example();
  const server = new LocalServer({ ...manifest, ready: { type: 'port', timeoutMs: 650 }, args: ['-e', 'console.error("EADDRINUSE");process.exit(1)'] });
  // Aislar el reloj de readiness del coste de CIM, probado con árboles reales
  // en hito3.test.js. Estos procesos ya salen solos y no crean descendientes.
  server.terminateTree = async () => {};
  t.after(() => server.stop());
  const start = Date.now();
  await assert.rejects(server.start(), /no abrió el puerto/);
  assert.ok(Date.now() - start < 1500);
  assert.ok(server.attempts > 1 && server.attempts <= 4);
  assert.ok(server.child.exitCode !== null || server.child.signalCode !== null);
});

test('un listener wildcard propio se rechaza y se termina sin reintentos', async t => {
  const manifest = await example();
  const server = new LocalServer({ ...manifest, args: ['-e', 'require("node:http").createServer((q,s)=>s.end("WILDCARD")).listen(Number(process.env.PORT),"0.0.0.0")'] });
  t.after(() => server.stop());
  await assert.rejects(server.start(), /solo en 127\.0\.0\.1/);
  assert.equal(server.attempts, 1);
  assert.equal(await isPortOpen(server.port), false);
});
