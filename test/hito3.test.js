'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { readManifest } = require('../src/manifest');
const { LocalServer, isPortOpen } = require('../src/server');

async function tree(t) {
  const manifest = await readManifest(path.join(__dirname, '../examples/process-tree/app.app.json'));
  manifest.command = process.execPath;
  const server = new LocalServer(manifest);
  t.after(() => server.stop());
  const url = await server.start();
  const info = await (await fetch(new URL('/pids', url))).json();
  return { server, ...info };
}

test('un ejecutable directo cierra su hijo y nieto detached', async t => {
  const { server, pids, port } = await tree(t);
  assert.equal(pids.length, 3);
  for (const pid of pids) assert.doesNotThrow(() => process.kill(pid, 0));
  await server.stop();
  for (const pid of pids) assert.throws(() => process.kill(pid, 0));
  assert.equal(await isPortOpen(port), false);
});

test('tras caer el padre cierra descendientes y conserva un nuevo listener ajeno', async t => {
  const { server, pids, port } = await tree(t);
  const exited = once(server.child, 'exit');
  server.child.kill();
  await exited;
  const other = http.createServer((_q, s) => s.end('AJENO'));
  other.listen(port, '127.0.0.1');
  await once(other, 'listening');
  t.after(() => new Promise(resolve => other.close(resolve)));
  await server.stop();
  for (const pid of pids) assert.throws(() => process.kill(pid, 0));
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'AJENO');
});

test('readiness acepta un listener descendiente de Node sin modo detached', async t => {
  const manifest = await readManifest(path.join(__dirname, '../examples/process-tree/app.app.json'));
  manifest.command = process.execPath;
  manifest.ready = { type: 'port', timeoutMs: 15000 };
  manifest.args = ['-e', `
    const child=require('node:child_process').spawn(process.execPath,['-e',
      'require("node:http").createServer((q,s)=>s.end("HIJO")).listen(Number(process.env.PORT),"127.0.0.1")'],
      {windowsHide:true,stdio:'inherit'});
    setInterval(()=>{},1000);
  `];
  const server = new LocalServer(manifest);
  t.after(() => server.stop());
  const url = await server.start();
  assert.notEqual(server.listenerPid, server.child.pid);
  assert.equal(await (await fetch(url)).text(), 'HIJO');
  const pid = server.listenerPid;
  await server.stop();
  assert.throws(() => process.kill(pid, 0));
});

test('un fallo de consulta del árbol se informa y aun así termina el proceso directo', async t => {
  const manifest = await readManifest(path.join(__dirname, '../examples/node/app.app.json'));
  manifest.command = process.execPath;
  const server = new LocalServer(manifest);
  await server.start();
  server.terminateTree = async () => { throw new Error('CIM de prueba no disponible'); };
  t.after(() => server.stop().catch(() => {}));
  await assert.rejects(server.stop(), /CIM de prueba no disponible/);
  assert.throws(() => process.kill(server.child.pid, 0));
  assert.equal(await isPortOpen(server.port), false);
});

test('un timeout de arranque también termina hijo y nieto detached', async t => {
  const manifest = await readManifest(path.join(__dirname, '../examples/process-tree/app.app.json'));
  manifest.command = process.execPath;
  manifest.ready = { type: 'stdout', pattern: 'NUNCA_LISTO', timeoutMs: 1500 };
  const server = new LocalServer(manifest);
  t.after(() => server.stop());
  await assert.rejects(server.start(), /patrón stdout/);
  const info = JSON.parse(server.tail().match(/Árbol listo: (\{[^\n]+\})/)[1]);
  for (const pid of info.pids) assert.throws(() => process.kill(pid, 0));
  assert.equal(await isPortOpen(info.port), false);
});

test('cancelar readiness HTTP termina el árbol antes de resolver el cierre', async t => {
  const manifest = await readManifest(path.join(__dirname, '../examples/process-tree/app.app.json'));
  manifest.command = process.execPath;
  const worker = path.join(__dirname, '../examples/process-tree/worker.js');
  manifest.args = ['-e', `
    const child=require('node:child_process').spawn(process.execPath,[${JSON.stringify(worker)}],
      {detached:true,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
    child.once('message',pids=>{
      console.log('PIDS='+JSON.stringify([process.pid,...pids]));
      require('node:http').createServer(()=>console.log('HEALTH')).listen(Number(process.env.PORT),'127.0.0.1');
    });
  `];
  manifest.ready = { type: 'http', path: '/health', timeoutMs: 15000 };
  const server = new LocalServer(manifest);
  t.after(() => server.stop());
  const pending = assert.rejects(server.start(), /Arranque cancelado/);
  const end = Date.now() + 10000;
  while (!server.tail().includes('HEALTH') && Date.now() < end) await delay(25);
  assert.match(server.tail(), /HEALTH/);
  const pids = JSON.parse(server.tail().match(/PIDS=(\[[^\n]+\])/)[1]);
  await server.stop();
  await pending;
  for (const pid of pids) assert.throws(() => process.kill(pid, 0));
  assert.equal(await isPortOpen(server.port), false);
});
