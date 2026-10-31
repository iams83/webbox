'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseOptions, prepareStatic } = require('../scripts/package-static');
const { readManifest } = require('../src/manifest');
const { createIco } = require('./helpers/icon-fixture');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox package '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stage = path.join(root, 'stage');
  await fs.mkdir(stage);
  return { root, stage };
}

test('empaquetar un HTML copia solo ese archivo y crea un manifiesto relativo', async t => {
  const { root, stage } = await fixture(t);
  const html = path.join(root, 'mi-web.html');
  await fs.writeFile(html, '<h1>Aplicación</h1>');
  await fs.writeFile(path.join(root, 'datos-privados.json'), 'privado');
  const options = parseOptions([html, '--name', 'Mi Web']);
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

test('el destino predeterminado es dist de WebBox para cualquier nombre', () => {
  for (const name of ['Mi Web', 'Otra aplicación', 'España']) {
    assert.equal(parseOptions(['web.html', '--name', name]).output, path.resolve(__dirname, '../dist'));
    assert.equal(parseOptions(['web.html', '--name', name, '--output', 'entregas']).output, path.resolve('entregas'));
  }
});

test('el acceso a documentos se incluye en el manifiesto empaquetado solo si se solicita', async t => {
  const { root, stage } = await fixture(t);
  const html = path.join(root, 'app.html'); await fs.writeFile(html, 'web');
  await prepareStatic(parseOptions([html, '--document-extensions', 'json,csv']), stage);
  assert.deepEqual((await readManifest(path.join(stage, 'app.app.json'))).documents, { extensions: ['json', 'csv'] });
});

test('el icono del EXE se incluye como icono de ventana sin exponerlo en la carpeta pública', async t => {
  const { root, stage } = await fixture(t);
  const html = path.join(root, 'app.html');
  const icon = path.join(root, 'marca.ico');
  const bytes = createIco();
  await fs.writeFile(html, '<h1>Web</h1>');
  await fs.writeFile(icon, bytes);
  const options = parseOptions([html, '--exe-icon', icon]);
  await prepareStatic(options, stage);
  const manifest = await readManifest(path.join(stage, 'app.app.json'));
  assert.equal(manifest.icon, path.join(stage, 'app-icon.ico'));
  assert.deepEqual(await fs.readFile(manifest.icon), bytes);
  assert.deepEqual(await fs.readdir(path.join(stage, 'public')), ['index.html']);
});

test('el icono de ventana puede diferir del EXE o configurarse sin cambiar el EXE', async t => {
  for (const withExe of [false, true]) {
    const { root, stage } = await fixture(t);
    const html = path.join(root, 'app.html');
    const exeIcon = path.join(root, 'exe.ico');
    const appIcon = path.join(root, 'window.ico');
    await fs.writeFile(html, '<h1>Web</h1>');
    await fs.writeFile(exeIcon, createIco(200, 30, 30));
    await fs.writeFile(appIcon, createIco(30, 200, 30));
    const options = parseOptions([html, '--app-icon', appIcon, ...(withExe ? ['--exe-icon', exeIcon] : [])]);
    await prepareStatic(options, stage);
    const manifest = await readManifest(path.join(stage, 'app.app.json'));
    assert.deepEqual(await fs.readFile(manifest.icon), await fs.readFile(appIcon));
    assert.notDeepEqual(await fs.readFile(manifest.icon), await fs.readFile(exeIcon));
  }
});

test('rechaza iconos ausentes, truncados o con formato incorrecto antes de empaquetar', async t => {
  const { root, stage } = await fixture(t);
  const html = path.join(root, 'app.html');
  const icon = path.join(root, 'bad.ico');
  await fs.writeFile(html, 'web');
  await assert.rejects(prepareStatic(parseOptions([html, '--exe-icon', icon]), stage), /No se puede leer --exe-icon/);
  await fs.writeFile(icon, 'no es un icono');
  await assert.rejects(prepareStatic(parseOptions([html, '--exe-icon', icon]), stage), /icono válido/);
  await assert.rejects(prepareStatic(parseOptions([html, '--exe-icon', 'imagen.png']), stage), /debe ser un archivo .ico/);
  await fs.writeFile(icon, createIco().subarray(0, 50));
  await assert.rejects(prepareStatic(parseOptions([html, '--app-icon', icon]), stage), /icono válido/);
});
