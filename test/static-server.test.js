'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { StaticServer } = require('../src/static-server');
const { readManifest } = require('../src/manifest');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox estático '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public', 'sección'), { recursive: true });
  await fs.writeFile(path.join(root, 'privado.txt'), 'secreto');
  await fs.writeFile(path.join(root, 'public', 'index.html'), '<h1>España</h1>');
  await fs.writeFile(path.join(root, 'public', 'app.mjs'), 'export const n = 42;');
  await fs.writeFile(path.join(root, 'public', 'sección', 'index.html'), 'sección');
  const filename = path.join(root, 'app.app.json');
  await fs.writeFile(filename, JSON.stringify({ name: 'Static', static: { root: 'public' } }));
  const manifest = await readManifest(filename);
  const server = new StaticServer(manifest);
  t.after(() => server.stop());
  return { root, server, manifest };
}

function request(server, pathname, { method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, path: pathname, method,
      headers: host ? { Host: host } : {}, agent: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('sirve HTML, módulos, HEAD e índices con MIME y redirección relativa correcta', async t => {
  const { server } = await fixture(t);
  const url = await server.start();
  assert.equal(url, `http://127.0.0.1:${server.port}/`);
  assert.equal(server.http.address().address, '127.0.0.1');
  const html = await request(server, '/?v=1');
  assert.equal(html.status, 200);
  assert.equal(html.body, '<h1>España</h1>');
  assert.match(html.headers['content-type'], /text\/html/);
  const head = await request(server, '/', { method: 'HEAD' });
  assert.equal(head.body, '');
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength(html.body));
  assert.match((await request(server, '/app.mjs')).headers['content-type'], /text\/javascript/);
  const directory = await request(server, '/secci%C3%B3n');
  assert.equal(directory.status, 301);
  assert.equal(directory.headers.location, '/secci%C3%B3n/');
  assert.equal((await request(server, directory.headers.location)).body, 'sección');
  assert.equal((await request(server, '/missing')).status, 404);
  assert.equal((await request(server, '/', { method: 'POST' })).status, 405);
});

test('rechaza traversal, rutas Windows, archivos ocultos, escapes inválidos y hosts ajenos', async t => {
  const { server } = await fixture(t);
  await server.start();
  for (const pathname of ['/../privado.txt', '/%2e%2e/privado.txt', '/..%5cprivado.txt', '//servidor/ruta',
    '/C:/Windows/win.ini', '/index.html:stream', '/%00', '/.git/config', '/%2eenv', '/%2f../privado.txt']) {
    assert.equal((await request(server, pathname)).status, 403, pathname);
  }
  assert.equal((await request(server, '/%zz')).status, 400);
  assert.equal((await request(server, '/', { host: 'example.com' })).status, 403);
});

test('no sigue enlaces que salgan de la raíz pública', async t => {
  const { root, server } = await fixture(t);
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'index.html'), 'privado');
  await fs.symlink(outside, path.join(root, 'public', 'link'), 'junction');
  await server.start();
  assert.equal((await request(server, '/link/')).status, 403);
});

test('puerto ocupado falla en fijo y el rango continúa; stop es idempotente', async t => {
  const first = await fixture(t);
  await first.server.start();
  const second = await fixture(t);
  second.manifest.port.fixed = first.server.port;
  await assert.rejects(second.server.start(), { code: 'EADDRINUSE' });
  const third = await fixture(t);
  third.manifest.port.range = [first.server.port, Math.min(first.server.port + 20, 65535)];
  await third.server.start();
  assert.ok(third.server.port > first.server.port);
  const port = third.server.port;
  await Promise.all([third.server.stop(), third.server.stop()]);
  assert.equal(third.server.ready, false);
  await assert.rejects(new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/`).on('error', reject).on('response', resolve);
  }));
});

test('cancelar antes o durante el arranque no deja un listener', async t => {
  const { server } = await fixture(t);
  await server.stop();
  await assert.rejects(server.start(), /detenido/);
  const second = await fixture(t);
  const starting = second.server.start();
  await second.server.stop();
  await assert.rejects(starting, /detenido/);
  assert.equal(second.server.http?.listening ?? false, false);
});
