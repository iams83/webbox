'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { manageDownloads, downloadFilename } = require('../src/downloads');

function contents(session, id) {
  return Object.assign(new EventEmitter(), { id, session, isDestroyed: () => false });
}
function item(name) {
  return Object.assign(new EventEmitter(), {
    getFilename: () => name,
    setSaveDialogOptions(options) { this.options = options; },
    cancel() { this.cancelled = true; this.emit('done', {}, 'cancelled'); }
  });
}

test('el nombre sugerido no sale de la carpeta ni usa dispositivos de Windows', () => {
  for (const [input, expected] of [
    ['../España.txt', 'España.txt'], ['C:\\fuera\\archivo.txt', 'archivo.txt'],
    ['CON.txt', '_CON.txt'], ['in:forme?.txt', 'in_forme_.txt'], ['...', 'descarga'], ['', 'descarga']
  ]) assert.equal(downloadFilename(input), expected);
});

test('dos vistas de la misma sesión coordinan descargas y cancelan solo las propias', () => {
  const session = new EventEmitter();
  const a = contents(session, 1), b = contents(session, 2);
  const logs = [], failures = [];
  const options = { directory: 'C:\\Descargas', log: text => logs.push(text), failed: text => failures.push(text) };
  const removeA = manageDownloads(a, options), removeB = manageDownloads(b, options);
  assert.equal(session.listenerCount('will-download'), 1);
  const first = item('España.txt'), second = item('b.txt');
  session.emit('will-download', {}, first, a);
  session.emit('will-download', {}, second, b);
  assert.equal(first.options.title, 'Guardar archivo');
  assert.deepEqual(first.options.properties, ['showOverwriteConfirmation']);
  assert.equal(first.options.defaultPath, 'C:\\Descargas\\España.txt');
  removeA(); removeA();
  assert.equal(first.cancelled, true);
  assert.equal(second.cancelled, undefined);
  second.emit('done', {}, 'interrupted');
  assert.equal(failures.length, 1);
  assert.equal(logs.length, 2);
  removeB();
  assert.equal(session.listenerCount('will-download'), 0);
});

test('rechaza descargas de una vista sin registrar y limpia al destruirla', () => {
  const session = new EventEmitter(), a = contents(session, 1), b = contents(session, 2);
  manageDownloads(a, { directory: 'C:\\Descargas', log: () => {}, failed: () => {} });
  let prevented = false;
  session.emit('will-download', { preventDefault: () => { prevented = true; } }, item('x'), b);
  assert.equal(prevented, true);
  a.emit('destroyed');
  assert.equal(session.listenerCount('will-download'), 0);
});
