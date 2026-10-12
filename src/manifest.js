'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const Ajv = require('ajv');
const validate = new Ajv({ allErrors: false, strict: true }).compile(require('./manifest.schema.json'));

function validateSchema(data) {
  if (validate(data)) return;
  const error = validate.errors[0];
  const parts = error.instancePath.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let field = parts.map(part => /^\d+$/.test(part) ? '[' + part + ']' : '.' + part).join('').replace(/^\./, '');
  const property = error.params.additionalProperty ?? error.params.missingProperty;
  if (property) field += (field ? '.' : '') + property;
  const messages = {
    additionalProperties: 'no es un campo reconocido.', required: 'es obligatorio.',
    type: error.params.type === 'array' ? 'debe ser una lista.' : 'tiene un tipo incorrecto.',
    enum: 'solo admite ' + (error.params.allowedValues ?? []).join(', ') + '.',
    minimum: 'está por debajo del mínimo permitido.', maximum: 'supera el máximo permitido.',
    minLength: 'no puede estar vacío.', maxLength: 'es demasiado largo.',
    minItems: 'no contiene suficientes elementos.', maxItems: 'contiene demasiados elementos.'
  };
  throw fieldError(field || 'raíz', messages[error.keyword] ?? 'no cumple el esquema.');
}

function fieldError(field, message) {
  return new Error('Manifiesto: ' + field + ' ' + message);
}

function objectField(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fieldError(field, 'debe ser un objeto.');
  }
}

function noNul(value, field) {
  if (value.includes('\0')) throw fieldError(field, 'no puede contener el carácter NUL.');
}

function envName(value, field) {
  if (typeof value !== 'string' || !value.trim() || /[=\u0000-\u001f\u007f]/.test(value)) {
    throw fieldError(field, 'debe ser un nombre de variable de entorno no vacío, sin = ni caracteres de control.');
  }
}

function localPath(value, field) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
    || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw fieldError(field, 'debe ser una ruta local que empiece por /, sin caracteres de control.');
  }
}

// El esquema valida la estructura; debajo se comprueban contratos entre campos.
async function readManifest(filename) {
  if (!filename) throw new Error('Falta el manifiesto. Uso: launcher.exe ruta\\al\\manifiesto.json [--debug] [--trust]');
  const manifestPath = path.resolve(filename);
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new Error('No se puede leer el manifiesto «' + manifestPath + '»: ' + error.code + '.');
  }
  let data;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('El manifiesto «' + manifestPath + '» no contiene JSON válido.');
  }
  objectField(data, 'raíz');
  validateSchema(data);
  for (const field of ['name', 'command']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      throw fieldError(field, 'es obligatorio y debe ser texto no vacío.');
    }
    noNul(data[field], field);
  }
  const command = data.command;
  if (/\s/.test(command) && !/[\\/]/.test(command)) {
    throw fieldError('command', 'debe ser un ejecutable; separa los argumentos en args[].');
  }
  // & es válido en una ruta: con shell:false no tiene semántica de shell.
  if (/[\u0000-\u001f"<>|]/.test(command)) {
    throw fieldError('command', 'contiene caracteres que no pertenecen a un ejecutable.');
  }
  (data.args ?? []).forEach((arg, index) => noNul(arg, 'args[' + index + ']'));
  for (const field of ['cwd', 'icon', 'title']) {
    if (data[field] !== undefined) {
      noNul(data[field], field);
    }
  }
  const env = data.env === undefined ? {} : data.env;
  for (const [key, value] of Object.entries(env)) {
    envName(key, 'env.' + key);
    noNul(value, 'env.' + key);
  }
  const port = data.port === undefined ? {} : data.port;
  const mode = port.mode === undefined ? 'env' : port.mode;
  if (port.fixed !== undefined && port.range !== undefined) {
    throw fieldError('port', 'fixed y range son mutuamente excluyentes.');
  }
  if (port.range !== undefined) {
    if (port.range[0] > port.range[1]) throw fieldError('port.range', 'inicio no puede superar fin.');
  }
  const portName = port.name === undefined ? (mode === 'arg' ? '--port' : 'PORT') : port.name;
  if (mode === 'env') envName(portName, 'port.name');
  if (mode === 'arg' && !/^--?[A-Za-z][A-Za-z0-9_-]*$/.test(portName)) {
    throw fieldError('port.name', 'debe ser un argumento como --port o -p.');
  }
  if (mode === 'arg' && (data.args ?? []).some(arg => arg === portName || arg.startsWith(portName + '='))) {
    throw fieldError('args', 'ya contiene el argumento ' + portName + '; WebBox lo añade automáticamente.');
  }
  if (mode === 'placeholder') {
    if (port.name !== undefined) throw fieldError('port.name', 'no se admite en modo placeholder.');
    if (!(data.args ?? []).some(arg => arg.includes('{PORT}')) && !Object.values(env).some(value => value.includes('{PORT}'))) {
      throw fieldError('port.mode', 'placeholder exige {PORT} en args o env.');
    }
  }
  const ready = data.ready === undefined ? {} : data.ready;
  const readyType = ready.type === undefined ? 'port' : ready.type;
  if (ready.pattern !== undefined && readyType !== 'stdout') throw fieldError('ready.pattern', 'solo se admite con readiness stdout.');
  if (readyType === 'stdout') {
    if (!ready.pattern) throw fieldError('ready.pattern', 'es obligatorio para stdout.');
    try { new RegExp(ready.pattern); } catch { throw fieldError('ready.pattern', 'debe ser una expresión regular JavaScript válida, sin delimitadores ni flags.'); }
    if (data.detached) throw fieldError('detached', 'no admite readiness stdout; usa port o http.');
  }
  if (ready.path !== undefined && readyType !== 'http') {
    throw fieldError('ready.path', 'solo se admite con ready.type "http".');
  }
  const readyPath = ready.path === undefined ? '/' : ready.path;
  if (readyType === 'http') localPath(readyPath, 'ready.path');
  const timeoutMs = ready.timeoutMs === undefined ? 30000 : ready.timeoutMs;
  const startUrl = data.startUrl === undefined ? '/' : data.startUrl;
  localPath(startUrl, 'startUrl');
  const window = data.window === undefined ? {} : data.window;
  const windowOptions = { width: 1100, height: 760, minWidth: 480, minHeight: 320 };
  for (const field of Object.keys(windowOptions)) {
    if (window[field] !== undefined) {
      windowOptions[field] = window[field];
    }
  }
  for (const [field, value] of [
    ['singleInstance', data.singleInstance],
    ['window.rememberBounds', window.rememberBounds]
  ]) {
    if (value === true) throw fieldError(field, 'todavía no está implementado en el prototipo.');
  }
  const baseDir = path.dirname(manifestPath);
  return {
    manifestPath, name: data.name, title: data.title ?? data.name,
    icon: data.icon ? path.resolve(baseDir, data.icon) : undefined,
    command: /[\\/]/.test(command) ? path.resolve(baseDir, command) : command,
    args: data.args ?? [], cwd: path.resolve(baseDir, data.cwd ?? '.'), env,
    port: { mode, name: portName,
      ...(port.fixed !== undefined ? { fixed: port.fixed } : {}),
      ...(port.range !== undefined ? { range: port.range } : {}) },
    ready: { type: readyType, timeoutMs, ...(readyType === 'http' ? { path: readyPath } : {}),
      ...(readyType === 'stdout' ? { pattern: ready.pattern } : {}) },
    detached: data.detached ?? false,
    logOnStart: data.logOnStart ?? false,
    startUrl, window: windowOptions
  };
}

function parseArguments(argv) {
  const options = { debug: false, trust: false, manifestPath: undefined };
  for (const arg of argv) {
    if (arg === '--debug') options.debug = true;
    else if (arg === '--trust') options.trust = true;
    else if (arg.startsWith('--')) throw new Error('Parámetro desconocido: ' + arg + '.');
    else if (options.manifestPath) throw new Error('Indica un único fichero manifiesto.');
    else options.manifestPath = arg;
  }
  return options;
}

module.exports = { readManifest, parseArguments };
