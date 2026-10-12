'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('../src/load-page');

test('una página que no responde agota el plazo y cancela la navegación', async () => {
  let stopped = false;
  const contents = { loadURL: () => new Promise(() => {}), isDestroyed: () => false, stop: () => stopped = true };
  await assert.rejects(loadPage(contents, 'http://localhost/', 25), /no terminó de cargar en 25 ms/);
  assert.equal(stopped, true);
});

test('el cierre cancela inmediatamente una carga pendiente', async () => {
  const controller = new AbortController();
  let rejectLoad;
  let stopped = false;
  const contents = {
    loadURL: () => new Promise((_resolve, reject) => rejectLoad = reject),
    isDestroyed: () => false,
    stop: () => { stopped = true; rejectLoad(new Error('ERR_ABORTED')); }
  };
  const pending = loadPage(contents, 'http://localhost/', 1000, controller.signal);
  controller.abort(new Error('Ventana cerrada'));
  await assert.rejects(pending, /Ventana cerrada/);
  assert.equal(stopped, true);
});

test('una carga cancelada antes del inicio no navega', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Cancelada'));
  const contents = { loadURL: () => assert.fail('No debe navegar'), isDestroyed: () => true };
  await assert.rejects(loadPage(contents, 'http://localhost/', 1000, controller.signal), /Cancelada/);
});

test('el éxito y el fallo de red conservan su resultado y limpian el plazo', async () => {
  const contents = { loadURL: async () => {}, isDestroyed: () => false, stop: () => assert.fail('No debe detenerse') };
  await loadPage(contents, 'http://localhost/', 1000);
  contents.loadURL = async () => { throw new Error('ERR_CONNECTION_REFUSED'); };
  await assert.rejects(loadPage(contents, 'http://localhost/', 1000), /ERR_CONNECTION_REFUSED/);
});
