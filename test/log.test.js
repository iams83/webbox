'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { LogBuffer } = require('../src/log-buffer');
const { LogWriter } = require('../src/log-writer');

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'WebBox log España '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('recompone líneas entre fragmentos y mantiene estilos independientes por stream', () => {
  const log = new LogBuffer();
  log.write('stdout', 'REA\x1b['); log.write('stderr', 'error\n');
  log.write('stdout', '31;1mDY España\r'); log.write('stdout', '\nrojo\x1b[0m normal\n');
  const lines = log.snapshot().lines;
  assert.deepEqual(lines.map(line => line.text), ['READY España', 'error', 'rojo normal']);
  assert.equal(lines[0].spans[1].color, 'red');
  assert.equal(lines[0].spans[1].bold, true);
  assert.equal(lines[1].spans[0].color, undefined);
  assert.equal(lines[2].spans[0].color, 'red');
  assert.equal(lines[2].spans[1].color, undefined);
  assert.doesNotMatch(log.tail(), /\x1b/);
});

test('retorno de carro actualiza progreso y consume controles de terminal/OSC', () => {
  const log = new LogBuffer();
  log.write('stdout', '10%\r'); log.write('stdout', '50%\r100%\n\x1b]52;c;c2VjcmV0\x07literal <script>\x1b[2J\n');
  assert.deepEqual(log.snapshot().lines.map(line => line.text), ['100%', 'literal <script>']);
  log.write('stdout', '\x1b]8;;https://example.com\x1b'); log.write('stdout', '\\texto\x1b]8;;\x1b\\\n');
  assert.equal(log.snapshot().lines.at(-1).text, 'texto');
});

test('conserva 10000 líneas, acota una línea y los cambios de estilo', () => {
  const log = new LogBuffer();
  log.write('stdout', Array.from({ length: 10005 }, (_, index) => index + '\n').join(''));
  assert.equal(log.snapshot().lines.length, 10000);
  assert.equal(log.snapshot().lines[0].text, '5');
  log.write('stderr', ('\x1b[31mx\x1b[32my').repeat(2500));
  const line = log.snapshot().lines.at(-1);
  assert.equal(line.text.length, 4096);
  assert.equal(line.truncated, true);
  assert.ok(line.spans.length <= 128);
  assert.equal(log.snapshot().lines.length, 10000);
});

test('limpiar/cerrar preserva el archivo y vacía el visor sin perder el fragmento final', async t => {
  const dir = await directory(t);
  const log = new LogBuffer(); log.persist(dir);
  log.write('stdout', 'antes\nparcial'); log.clear();
  assert.equal(log.visibleSnapshot().lines.length, 0);
  log.write('stdout', ' completado\nnuevo\n');
  assert.equal(log.text(), '[stdout] nuevo');
  log.write('stderr', 'último España');
  await log.close();
  const text = await fs.readFile(log.writer.filename, 'utf8');
  assert.match(text, /antes\n.*parcial completado\n.*nuevo\n.*último España\n/s);
});

test('rotación mantiene el límite por bytes UTF-8 y tres copias', async t => {
  const dir = await directory(t);
  const writer = new LogWriter(dir, { maxBytes: 90 });
  const warnings = []; writer.on('warning', error => warnings.push(error));
  writer.append(Array.from({ length: 20 }, (_, index) => 'España ' + index + ' · áéíóú\n'));
  await writer.close();
  const files = await fs.readdir(dir);
  assert.equal(files.length, 4);
  for (const name of files) {
    const data = await fs.readFile(path.join(dir, name));
    assert.ok(data.length <= 90);
    assert.doesNotMatch(data.toString('utf8'), /�/);
  }
  assert.match(await fs.readFile(writer.filename, 'utf8'), /España 19/);
  assert.equal(warnings.length, 0);
});

test('ejecuciones simultáneas tienen archivos independientes', async t => {
  const dir = await directory(t);
  const a = new LogWriter(dir), b = new LogWriter(dir);
  a.append(['A\n']); b.append(['B\n']);
  await Promise.all([a.close(), b.close()]);
  assert.notEqual(a.filename, b.filename);
  assert.equal(await fs.readFile(a.filename, 'utf8'), 'A\n');
  assert.equal(await fs.readFile(b.filename, 'utf8'), 'B\n');
});

test('fallo de disco o exceso de cola se informa y conserva el visor', async t => {
  const dir = await directory(t), file = path.join(dir, 'archivo');
  await fs.writeFile(file, 'ocupado');
  const log = new LogBuffer(); log.persist(file); log.write('stdout', 'sigue funcionando\n');
  await log.close();
  assert.match(log.diskError, /No se pudo guardar/);
  assert.match(log.text(), /sigue funcionando/);
  const overloaded = new LogBuffer(); overloaded.persist(dir, { queueLimit: 8 });
  overloaded.write('stdout', 'texto demasiado largo\n');
  await overloaded.close();
  assert.match(overloaded.diskError, /límite de escritura/);
  assert.match(overloaded.text(), /demasiado largo/);
});
