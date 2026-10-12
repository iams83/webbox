'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readManifest } = require('../src/manifest');
const { LocalServer, isPortOpen } = require('../src/server');

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
  await missing.stop();
  const exited = new LocalServer({ ...await example(), args: ['-e', 'process.exit(0)'] });
  t.after(() => exited.stop());
  await assert.rejects(exited.start(), /código 0.*segundo plano/);
});


test('el cierre tiene un límite incluso si el sistema no termina el proceso', async () => {
  const server = new LocalServer({});
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
