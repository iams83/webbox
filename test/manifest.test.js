'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readManifest, parseArguments } = require('../src/manifest');

async function fixture(t, data) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox España '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'aplicación.app.json');
  await fs.writeFile(filename, typeof data === 'string' ? data : JSON.stringify(data));
  return filename;
}

test('rutas relativas al manifiesto, con espacios, acentos y BOM', async t => {
  const filename = await fixture(t, '\uFEFF' + JSON.stringify({
    name: 'Prueba', command: './bin mi app/node.exe', args: ['server.js', '{PORT}'], cwd: './código', icon: './icono.ico'
  }));
  const manifest = await readManifest(filename);
  assert.equal(manifest.cwd, path.join(path.dirname(filename), 'código'));
  assert.equal(manifest.command, path.join(path.dirname(filename), 'bin mi app/node.exe'));
  assert.equal(manifest.icon, path.join(path.dirname(filename), 'icono.ico'));
  assert.deepEqual(manifest.args, ['server.js', '{PORT}']);
  assert.equal(manifest.ready.timeoutMs, 30000);
});

test('modo static resuelve raíz sin comando y rechaza campos de procesos externos', async t => {
  const filename = await fixture(t, { name: 'Estática', static: { root: './web España' } });
  const manifest = await readManifest(filename);
  assert.equal(manifest.static.root, path.join(path.dirname(filename), 'web España'));
  assert.equal(manifest.command, undefined);
  for (const extra of [{ command: 'node' }, { args: [] }, { env: {} }, { cwd: '.' }, { detached: false },
    { port: { mode: 'env' } }, { ready: { type: 'stdout', pattern: 'READY' } },
    { static: {} }, { static: { root: 'x\0y' } }]) {
    await assert.rejects(readManifest(await fixture(t, { name: 'Bad', static: { root: '.' }, ...extra })), /Manifiesto:/);
  }
  await assert.rejects(readManifest(await fixture(t, { name: 'Bad' })), /command/);
});

test('mensajes comprensibles para manifiestos ausentes y JSON inválido', async t => {
  await assert.rejects(readManifest(), /Falta el manifiesto/);
  const filename = await fixture(t, '{mal');
  await assert.rejects(readManifest(filename), /JSON válido/);
});

test('rechaza una línea de shell e identifica el campo erróneo', async t => {
  const filename = await fixture(t, { name: 'Prueba', command: 'npm start' });
  await assert.rejects(readManifest(filename), /command.*args/);
  const wrongArgs = await fixture(t, { name: 'Prueba', command: 'node', args: 'server.js' });
  await assert.rejects(readManifest(wrongArgs), /args.*lista/);
});

test('startUrl no puede escapar a un origen externo', async t => {
  for (const startUrl of ['https://example.com', '//example.com', '/\\example.com']) {
    const filename = await fixture(t, { name: 'Prueba', command: 'node', startUrl });
    await assert.rejects(readManifest(filename), /startUrl/);
  }
});

test('el manifiesto admite prefijos adicionales HTTP/HTTPS y mantiene la navegación local por defecto', async t => {
  const defaults = await readManifest(await fixture(t, { name: 'Default', command: 'node' }));
  assert.deepEqual(defaults.navigation, { allowedPrefixes: [] });
  const allowedPrefixes = ['https://docs.example.com/app/', 'http://localhost:{PORT}/extra/'];
  const manifest = await readManifest(await fixture(t, { name: 'Prefixes', command: 'node', navigation: { allowedPrefixes } }));
  assert.deepEqual(manifest.navigation.allowedPrefixes, allowedPrefixes);
  for (const prefix of ['https://user:password@example.com/', 'file:///C:/web/', 'javascript:alert(1)',
    'mailto:user@example.com', 'https://example.com/?q=1', 'https://example.com/#section',
    'https://example.com/\n', 'https://example.com/{OTHER}']) {
    await assert.rejects(readManifest(await fixture(t, {
      name: 'Bad prefix', command: 'node', navigation: { allowedPrefixes: [prefix] }
    })), /navigation.allowedPrefixes/);
  }
  await assert.rejects(readManifest(await fixture(t, { name: 'Bad', command: 'node', navigation: { allowedPrefixes: 'https://example.com/' } })), /navigation.allowedPrefixes/);
});


test('defaults se aplican también a objetos port y ready parciales', async t => {
  for (const port of [{}, { mode: 'env' }, { name: 'APP_PORT' }]) {
    const manifest = await readManifest(await fixture(t, { name: 'Prueba', command: 'node', port, ready: { timeoutMs: 2500 } }));
    assert.deepEqual(manifest.port, { mode: 'env', name: port.name ?? 'PORT' });
    assert.deepEqual(manifest.ready, { type: 'port', timeoutMs: 2500 });
  }
});

test('rutas de ejecutable con ampersand son válidas sin shell', async t => {
  const filename = await fixture(t, { name: 'Prueba', command: './R&D mi app/node.exe' });
  const manifest = await readManifest(filename);
  assert.equal(manifest.command, path.resolve(path.dirname(filename), 'R&D mi app/node.exe'));
});

test('rechaza NUL y nombres inválidos de variables con errores del campo', async t => {
  for (const [extra, field] of [
    [{ args: ['x\0y'] }, 'args[0]'], [{ command: 'node\0.exe' }, 'command'],
    [{ cwd: 'x\0y' }, 'cwd'], [{ env: { KEY: 'x\0y' } }, 'env.KEY'],
    [{ env: { 'A=B': 'x' } }, 'env.A=B'], [{ port: { name: '' } }, 'port.name']
  ]) {
    await assert.rejects(readManifest(await fixture(t, { name: 'Prueba', command: 'node', ...extra })),
      error => error.message.includes(field));
  }
});

test('timeouts fuera de límite y campos desconocidos fallan explícitamente', async t => {
  for (const timeoutMs of [null, 0, -1, 1.5, 120001, 1e30]) {
    await assert.rejects(readManifest(await fixture(t, { name: 'Prueba', command: 'node', ready: { timeoutMs } })), /ready.timeoutMs/);
  }
  for (const extra of [{ typo: true }, { window: { widht: 500 } }, { port: { names: 'PORT' } }]) {
    await assert.rejects(readManifest(await fixture(t, { name: 'Prueba', command: 'node', ...extra })), /no es un campo reconocido/);
  }
});

test('opciones pendientes se rechazan al activarlas y aceptan false', async t => {
  for (const field of ['singleInstance']) {
    await assert.rejects(readManifest(await fixture(t, { name: 'Prueba', command: 'node', [field]: true })), /no está implementado/);
  }
  await assert.rejects(readManifest(await fixture(t, { name: 'Prueba', command: 'node', window: { rememberBounds: true } })), /rememberBounds/);
  await readManifest(await fixture(t, { name: 'Prueba', command: 'node', detached: false, singleInstance: false, logOnStart: false }));
});

test('logOnStart admite true y por defecto vale false', async t => {
  assert.equal((await readManifest(await fixture(t, { name: 'Logs', command: 'node' }))).logOnStart, false);
  assert.equal((await readManifest(await fixture(t, { name: 'Logs', command: 'node', logOnStart: true }))).logOnStart, true);
});

test('puertos arg y placeholder tienen contratos separados y detached acepta port/http', async t => {
  const arg = await readManifest(await fixture(t, { name: 'Arg', command: 'node', port: { mode: 'arg' } }));
  assert.equal(arg.port.name, '--port');
  const placeholder = await readManifest(await fixture(t, { name: 'Placeholder', command: 'node', port: { mode: 'placeholder' }, args: ['--port={PORT}'], detached: true }));
  assert.equal(placeholder.detached, true);
  for (const extra of [
    { port: { mode: 'arg', name: '--port=evil' } }, { port: { mode: 'arg' }, args: ['--port', '1234'] },
    { port: { mode: 'placeholder' } }, { port: { mode: 'placeholder', name: 'PORT' }, args: ['{PORT}'] },
    { detached: true, ready: { type: 'stdout', pattern: 'READY' } }
  ]) await assert.rejects(readManifest(await fixture(t, { name: 'Bad', command: 'node', ...extra })), /Manifiesto:/);
});

test('stdout exige una expresión regular válida y rechaza patrones sin stdout', async t => {
  const manifest = await readManifest(await fixture(t, { name: 'Stdout', command: 'node', ready: { type: 'stdout', pattern: 'READY\\s+España' } }));
  assert.equal(manifest.ready.pattern, 'READY\\s+España');
  for (const ready of [{ type: 'stdout' }, { type: 'stdout', pattern: '[' }, { type: 'stdout', pattern: '' }, { type: 'stdout', pattern: 'x'.repeat(513) }, { type: 'port', pattern: 'READY' }]) {
    await assert.rejects(readManifest(await fixture(t, { name: 'Bad', command: 'node', ready })), /ready.pattern/);
  }
});

test('argumentos mantienen el nombre del fichero completo', () => {
  assert.deepEqual(parseArguments(['C:\\Mis apps\\España.app.json', '--debug', '--trust']), {
    manifestPath: 'C:\\Mis apps\\España.app.json', debug: true, trust: true, appArgs: []
  });
  assert.deepEqual(parseArguments(['a.json', 'b.json', '--modo', 'España con espacios']).appArgs, ['b.json', '--modo', 'España con espacios']);
  assert.throws(() => parseArguments(['--desconocido']), /desconocido/);
});

test('separador CLI conserva literalmente opciones y argumentos de la aplicación', () => {
  const args = ['--debug', '--trust', '--manifest', 'otra.json', '', 'España con espacios', 'a"b', '{PORT}', '&'];
  const options = parseArguments(['app.json', '--', ...args]);
  assert.equal(options.debug, false);
  assert.equal(options.manifestPath, 'app.json');
  assert.deepEqual(options.appArgs, args);
  assert.throws(() => parseArguments(['app.json', '--', 'a\0b']), /NUL/);
});

test('un EXE con manifiesto integrado recibe argumentos sin confundirlos con otro manifiesto', () => {
  const embeddedManifestPath = 'embedded/app.app.json';
  const options = parseArguments(['datos.json', '--modo', 'prueba'], { embeddedManifestPath });
  assert.equal(options.manifestPath, embeddedManifestPath);
  assert.deepEqual(options.appArgs, ['datos.json', '--modo', 'prueba']);
  assert.deepEqual(parseArguments(['--modo', 'prueba'], { embeddedManifestPath }).appArgs, ['--modo', 'prueba']);
  const overridden = parseArguments(['--manifest', 'otra.json', '--debug', '--', '--debug'], { embeddedManifestPath });
  assert.equal(overridden.manifestPath, 'otra.json');
  assert.equal(overridden.debug, true);
  assert.deepEqual(overridden.appArgs, ['--debug']);
  assert.throws(() => parseArguments(['--manifest']), /Falta la ruta/);
  assert.throws(() => parseArguments(['--manifest', 'a.json', '--manifest', 'b.json']), /único/);
});

test('HTTP usa / por defecto y admite una ruta propia independiente de startUrl', async t => {
  for (const ready of [{ type: 'http' }, { type: 'http', path: '/salud?modo=rápido', timeoutMs: 2500 }]) {
    const manifest = await readManifest(await fixture(t, { name: 'HTTP', command: 'node', startUrl: '/app', ready }));
    assert.deepEqual(manifest.ready, { type: 'http', path: ready.path ?? '/', timeoutMs: ready.timeoutMs ?? 30000 });
    assert.equal(manifest.startUrl, '/app');
  }
});

test('readiness HTTP rechaza rutas externas y opciones incompatibles por campo', async t => {
  for (const ready of [
    { type: 'http', path: '//example.com' }, { type: 'http', path: '/\\example.com' },
    { type: 'http', path: 'https://example.com' }, { type: 'http', path: '/x\n' },
    { type: 'http', path: null }, { type: 'port', path: '/health' }, { path: '/health' }
  ]) {
    await assert.rejects(readManifest(await fixture(t, { name: 'HTTP', command: 'node', ready })), /ready.path/);
  }
  for (const ready of [{ type: 'stdout' }, { type: 'http', pattern: 'READY' }]) {
    await assert.rejects(readManifest(await fixture(t, { name: 'HTTP', command: 'node', ready })), /ready\.(type|pattern)/);
  }
});

test('puerto fijo y rango inclusivo conservan sus valores y defaults', async t => {
  for (const port of [{ fixed: 1 }, { fixed: 65535 }, { range: [3000, 3010] }, { range: [65535, 65535] }]) {
    const manifest = await readManifest(await fixture(t, { name: 'Puertos', command: 'node', port }));
    assert.deepEqual(manifest.port, { mode: 'env', name: 'PORT', ...port });
  }
});

test('puertos y rangos inválidos se rechazan antes de ejecutar el comando', async t => {
  for (const port of [
    { fixed: 0 }, { fixed: 65536 }, { fixed: 1.2 }, { fixed: '3000' }, { fixed: null },
    { range: null }, { range: '3000-3010' }, { range: [3000] }, { range: [3000, 3010, 3020] },
    { range: [3010, 3000] }, { range: [0, 3000] }, { range: [3000, 65536] },
    { range: [3000, '3010'] }, { fixed: 3000, range: [3000, 3010] }
  ]) {
    await assert.rejects(readManifest(await fixture(t, { name: 'Puertos', command: 'node', port })), /Manifiesto: port/);
  }
});
