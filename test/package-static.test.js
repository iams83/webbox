'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseOptions, prepareStatic } = require('../scripts/package-static');
const { readManifest } = require('../src/manifest');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox package '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stage = path.join(root, 'stage');
  await fs.mkdir(stage);
  return { root, stage };
}

test('empaquetar un HTML copia solo ese archivo y crea un manifiesto relativo', async t => {
  const { root, stage } = await fixture(t);
  const html = path.join(root, 'singladura.html');
  await fs.writeFile(html, '<h1>Aplicación</h1>');
  await fs.writeFile(path.join(root, 'finanzas.json'), 'privado');
  const options = parseOptions([html, '--name', 'Singladura']);
  await prepareStatic(options, stage);
  assert.deepEqual(await fs.readdir(stage), ['app.app.json', 'public']);
  assert.deepEqual(await fs.readdir(path.join(stage, 'public')), ['index.html']);
  assert.equal(await fs.readFile(path.join(stage, 'public', 'index.html'), 'utf8'), '<h1>Aplicación</h1>');
  assert.equal((await readManifest(path.join(stage, 'app.app.json'))).static.root, path.join(stage, 'public'));
});

test('carpeta pública incluye recursos anidados y exige un índice', async t => {
  const { root, stage } = await fixture(t);
  const input = path.join(root, 'public');
  await fs.mkdir(path.join(input, 'assets'), { recursive: true });
  await fs.writeFile(path.join(input, 'index.html'), 'index');
  await fs.writeFile(path.join(input, 'assets', 'app.js'), 'app');
  await prepareStatic(parseOptions([input]), stage);
  assert.equal(await fs.readFile(path.join(stage, 'public', 'assets', 'app.js'), 'utf8'), 'app');
});

test('rechaza carpetas de proyecto, enlaces y salidas dentro de la web', async t => {
  for (const name of ['.git', 'node_modules', 'link']) {
    const { root, stage } = await fixture(t);
    const input = path.join(root, 'public');
    await fs.mkdir(input);
    await fs.writeFile(path.join(input, 'index.html'), 'index');
    if (name === 'link') await fs.symlink(stage, path.join(input, name), 'junction');
    else await fs.mkdir(path.join(input, name));
    await assert.rejects(prepareStatic(parseOptions([input]), stage), /públicos|enlaces simbólicos/);
  }
  const { root, stage } = await fixture(t);
  await assert.rejects(prepareStatic(parseOptions([root, '--output', path.join(root, 'dist')]), stage), /fuera|temporal/);
});

test('CLI valida nombres, opciones y valores antes de empaquetar', () => {
  assert.equal(parseOptions(['España.html']).slug, 'espana');
  for (const args of [[], ['x.html', '--name'], ['x.html', '--typo'], ['x.html', 'y.html'],
    ['x.html', '--name', '../escape'], ['x.html', '--name', '']]) assert.throws(() => parseOptions(args));
});
