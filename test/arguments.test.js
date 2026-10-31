'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readManifest, parseArguments, applyOverrides } = require('../src/manifest');
const { LocalServer } = require('../src/server');

async function fixture(t, data, appArgs) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox arguments España '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'app.json');
  await fs.writeFile(filename, JSON.stringify({ name: 'Arguments', command: process.execPath, ...data }));
  const options = parseArguments([filename, '--port', '43210', '--', ...appArgs]);
  const server = new LocalServer(applyOverrides(await readManifest(options.manifestPath), options), undefined, options.appArgs);
  t.after(() => server.logs.close());
  server.port = server.manifest.port.fixed;
  return server;
}

test('los argumentos CLI se añaden tras los del manifiesto y el puerto, sin sustituir sus valores', async t => {
  for (const mode of ['env', 'arg', 'placeholder']) {
    const appArgs = ['--archivo', 'España con espacios.json', '', '{PORT}', 'a"b', '&'];
    const args = ['server.js', ...(mode === 'placeholder' ? ['--listen={PORT}'] : [])];
    const server = await fixture(t, { args, port: { mode } }, appArgs);
    await server.prepareRuntime();
    const expected = ['server.js', ...(mode === 'arg' ? ['--port', '43210'] : mode === 'placeholder' ? ['--listen=43210'] : []), ...appArgs];
    assert.deepEqual(server.runtime.args, expected);
    await server.prepareRuntime();
    assert.deepEqual(server.runtime.args, expected, 'Preparar un reintento no debe duplicar argumentos.');
  }
});

test('los argumentos CLI no pueden sobrescribir el puerto gestionado por WebBox', async t => {
  for (const appArgs of [['--port', '1234'], ['--port=1234']]) {
    const server = await fixture(t, { args: ['server.js'], port: { mode: 'arg' } }, appArgs);
    await assert.rejects(server.prepareRuntime(), /WebBox lo añade automáticamente/);
    assert.equal(server.child, null);
  }
});

test('Node y Python reciben los argumentos originales en el proceso real', async t => {
  const appArgs = ['--modo', 'España con espacios', '', 'a"b', 'R&D', '{PORT}', '--debug'];
  for (const runtime of ['node', 'python']) {
    const server = await fixture(t, {
      command: runtime === 'node' ? process.execPath : 'python',
      args: runtime === 'node'
        ? ['-e', 'console.log("ARGS="+JSON.stringify(process.argv.slice(1)))', '--']
        : ['-c', 'import sys,json;print("ARGS="+json.dumps(sys.argv[1:],ensure_ascii=False))']
    }, appArgs);
    await server.prepareRuntime();
    server.spawnServer();
    t.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    await server.exitPromise;
    const line = server.tail().split('\n').find(text => text.includes('ARGS='));
    assert.ok(line, server.failure?.message || server.tail());
    assert.deepEqual(JSON.parse(line.slice(line.indexOf('ARGS=') + 5)), appArgs, runtime);
  }
});
