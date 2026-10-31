'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DocumentFiles, installDocumentBridge } = require('../src/document-files');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox documents España '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'datos.json');
  await fs.writeFile(original, '{"value":1}');
  const dialogs = [], responses = [];
  const dialog = Object.fromEntries(['showOpenDialog', 'showSaveDialog'].map(method => [method, async (_window, options) => {
    dialogs.push({ method, options }); return responses.shift();
  }]));
  const files = new DocumentFiles({ extensions: ['json'], startupFile: original, directory: root, dialog, window: () => null });
  return { root, original, files, dialogs, responses };
}

test('abrir por argumento requiere activar el documento validado antes de sobrescribirlo', async t => {
  const { files, original, root, dialogs } = await fixture(t);
  const selection = await files.initial();
  assert.equal(files.current, null);
  assert.equal(selection.content, '{"value":1}');
  assert.throws(() => files.activate('incorrecto'), /selección/);
  files.activate(selection.id);
  const saved = await files.save({ content: '{"value":2}' });
  assert.equal(saved.path, original);
  assert.equal(await fs.readFile(original, 'utf8'), '{"value":2}');
  assert.equal(dialogs.length, 0);
  assert.deepEqual(await fs.readdir(root), ['datos.json']);
});

test('el portable resuelve nombres relativos de documentos junto al EXE y no en su extracción temporal', async t => {
  const { files, root } = await fixture(t);
  const previous = process.env.PORTABLE_EXECUTABLE_DIR;
  process.env.PORTABLE_EXECUTABLE_DIR = root;
  try {
    const portable = new DocumentFiles({ extensions: ['json'], startupFile: 'datos.json', directory: root, dialog: files.dialog, window: () => null });
    assert.equal((await portable.initial()).path, path.join(root, 'datos.json'));
    const folder = new DocumentFiles({ extensions: ['json'], startupFile: '.', directory: root, dialog: files.dialog, window: () => null });
    assert.equal((await folder.initial()).path, path.join(root, 'datos.json'));
  } finally {
    if (previous === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR; else process.env.PORTABLE_EXECUTABLE_DIR = previous;
  }
});

test('una carpeta abre el último nombre permitido en orden lexicográfico, sin recursión ni orden por fecha', async t => {
  const { files, root } = await fixture(t);
  const folder = path.join(root, 'Copias con espacios y acentos á');
  await fs.mkdir(folder);
  const first = path.join(folder, 'copia-10.json'), last = path.join(folder, 'copia-9.JSON');
  await fs.writeFile(first, '{"value":10}');
  await fs.writeFile(last, '{"value":9}');
  await fs.utimes(first, new Date(), new Date());
  await fs.utimes(last, new Date(0), new Date(0));
  await fs.writeFile(path.join(folder, 'z.txt'), 'ignorado');
  await fs.mkdir(path.join(folder, 'z.json'));
  await fs.writeFile(path.join(folder, 'z.json', 'z.json'), '{}');
  files.startupFile = folder;
  const selection = await files.initial();
  assert.equal(selection.name, 'copia-9.JSON');
  assert.equal(selection.content, '{"value":9}');
  assert.equal(files.current, null);
  files.activate(selection.id);
  await files.save({ content: '{"saved":true}' });
  assert.equal(await fs.readFile(last, 'utf8'), '{"saved":true}');
  assert.equal(await fs.readFile(first, 'utf8'), '{"value":10}');
  await fs.writeFile(path.join(folder, 'z.json.json'), '{}');
  assert.equal((await files.initial()).path, last, 'el documento actual no cambia al aparecer otra copia');
});

test('una carpeta sin documentos permitidos informa del error y conserva esa carpeta para Abrir', async t => {
  const { files, root, responses, dialogs } = await fixture(t);
  const empty = path.join(root, 'vacia'); await fs.mkdir(empty);
  await fs.writeFile(path.join(empty, 'notas.txt'), 'ignorado');
  files.startupFile = empty;
  await assert.rejects(files.initial(), /carpeta no contiene.*\.json/);
  assert.equal(files.current, null);
  responses.push({ canceled: true }); await files.open();
  assert.equal(dialogs[0].options.defaultPath, empty);
  files.startupFile = path.join(root, 'no existe');
  await assert.rejects(files.initial(), { code: 'ENOENT' });
});

test('Guardar como y Abrir usan la carpeta del documento actual y cancelar mantiene el original', async t => {
  const { files, root, original, responses, dialogs } = await fixture(t);
  files.activate((await files.initial()).id);
  responses.push({ canceled: true });
  assert.equal(await files.save({ content: '{}', saveAs: true }), null);
  assert.equal(files.current.path, original);
  const other = path.join(root, 'otra carpeta'); await fs.mkdir(other);
  const target = path.join(other, 'copia.json');
  responses.push({ canceled: false, filePath: target });
  await files.save({ content: '{"saved":true}', saveAs: true });
  assert.equal(dialogs[1].options.defaultPath, original);
  assert.equal(await fs.readFile(original, 'utf8'), '{"value":1}');
  assert.equal(files.current.path, target);
  responses.push({ canceled: true }); await files.open();
  assert.equal(dialogs[2].options.defaultPath, other);
  assert.equal(files.current.path, target);
});

test('errores, cambios externos y cancelaciones nunca marcan otro fichero como actual', async t => {
  const { files, original, root, responses } = await fixture(t);
  files.activate((await files.initial()).id);
  await fs.writeFile(original, '{"external":true}');
  await assert.rejects(files.save({ content: '{}' }), /ha cambiado fuera/);
  assert.equal(await fs.readFile(original, 'utf8'), '{"external":true}');
  const invalid = path.join(root, 'private.txt'); await fs.writeFile(invalid, 'secret');
  responses.push({ canceled: false, filePaths: [invalid] });
  await assert.rejects(files.open(), /Extensión/);
  assert.equal(files.current.path, original);
  await assert.rejects(files.save({ content: null }), /texto/);
  assert.deepEqual((await fs.readdir(root)).sort(), ['datos.json', 'private.txt']);
});

test('la integración rechaza iframes, otras ventanas y prefijos remotos, y serializa las operaciones', async t => {
  const { files } = await fixture(t);
  let handler, removed;
  const ipcMain = { handle: (_channel, callback) => { handler = callback; }, removeHandler: channel => { removed = channel; } };
  const mainFrame = { url: 'http://127.0.0.1:12345/' }, contents = { mainFrame };
  const bridge = installDocumentBridge({ ipcMain, contents, files, origin: 'http://127.0.0.1:12345', pathname: '/' });
  const event = { sender: contents, senderFrame: mainFrame };
  for (const bad of [{ sender: {}, senderFrame: mainFrame }, { sender: contents, senderFrame: { url: mainFrame.url } }]) {
    await assert.rejects(handler(bad, 'initial'), /no autorizado/);
  }
  mainFrame.url = 'https://allowed.example.com/';
  await assert.rejects(handler(event, 'initial'), /no autorizado/);
  mainFrame.url = 'http://127.0.0.1:12345/other';
  await assert.rejects(handler(event, 'initial'), /no autorizado/);
  mainFrame.url = 'http://127.0.0.1:12345/';
  const first = handler(event, 'initial');
  await assert.rejects(handler(event, 'open'), /en curso/);
  const selected = await first;
  await handler(event, 'activate', selected.id);
  await assert.rejects(handler(event, 'read', 'C:\\private.json'), /no válida/);
  await bridge.dispose(); assert.equal(removed, bridge.channel);
  await assert.rejects(handler(event, 'initial'), /no autorizado/);
});
