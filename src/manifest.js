'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function fieldError(field, message) {
  return new Error('Manifiesto: ' + field + ' ' + message);
}

function objectField(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fieldError(field, 'debe ser un objeto.');
  }
}

function knownFields(value, fields, prefix = '') {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) throw fieldError(prefix + field, 'no es un campo reconocido.');
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

// Validación del soporte actual; runtimes y readiness adicionales siguen pendientes.
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
  knownFields(data, ['name', 'title', 'icon', 'command', 'args', 'cwd', 'env', 'port', 'ready', 'startUrl', 'window', 'detached', 'singleInstance', 'logOnStart']);
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
  if (data.args !== undefined && (!Array.isArray(data.args) || data.args.some(arg => typeof arg !== 'string'))) {
    throw fieldError('args', 'debe ser una lista de textos.');
  }
  (data.args ?? []).forEach((arg, index) => noNul(arg, 'args[' + index + ']'));
  for (const field of ['cwd', 'icon', 'title']) {
    if (data[field] !== undefined) {
      if (typeof data[field] !== 'string' || (field === 'cwd' && !data[field])) {
        throw fieldError(field, 'debe ser texto' + (field === 'cwd' ? ' no vacío.' : '.'));
      }
      noNul(data[field], field);
    }
  }
  const env = data.env === undefined ? {} : data.env;
  objectField(env, 'env');
  for (const [key, value] of Object.entries(env)) {
    envName(key, 'env.' + key);
    if (typeof value !== 'string') throw fieldError('env.' + key, 'debe ser texto.');
    noNul(value, 'env.' + key);
  }
  const port = data.port === undefined ? {} : data.port;
  objectField(port, 'port');
  knownFields(port, ['mode', 'name', 'fixed', 'range'], 'port.');
  const mode = port.mode === undefined ? 'env' : port.mode;
  if (mode !== 'env') throw fieldError('port.mode', 'en el prototipo solo admite "env".');
  if (port.fixed !== undefined || port.range !== undefined) {
    throw fieldError('port', 'fixed y range se implementarán en el hito 2.');
  }
  const portName = port.name === undefined ? 'PORT' : port.name;
  envName(portName, 'port.name');
  const ready = data.ready === undefined ? {} : data.ready;
  objectField(ready, 'ready');
  knownFields(ready, ['type', 'timeoutMs', 'path', 'pattern'], 'ready.');
  if ((ready.type === undefined ? 'port' : ready.type) !== 'port') {
    throw fieldError('ready.type', 'en el prototipo solo admite "port".');
  }
  for (const field of ['path', 'pattern']) {
    if (ready[field] !== undefined) throw fieldError('ready.' + field, 'se implementará en el hito 2.');
  }
  const timeoutMs = ready.timeoutMs === undefined ? 30000 : ready.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw fieldError('ready.timeoutMs', 'debe ser un entero entre 1 y 120000.');
  }
  const startUrl = data.startUrl === undefined ? '/' : data.startUrl;
  if (typeof startUrl !== 'string' || !startUrl.startsWith('/') || startUrl.startsWith('//')
    || startUrl.includes('\\') || /[\u0000-\u001f\u007f]/.test(startUrl)) {
    throw fieldError('startUrl', 'debe ser una ruta local que empiece por /, sin caracteres de control.');
  }
  const window = data.window === undefined ? {} : data.window;
  objectField(window, 'window');
  knownFields(window, ['width', 'height', 'minWidth', 'minHeight', 'rememberBounds'], 'window.');
  const windowOptions = { width: 1100, height: 760, minWidth: 480, minHeight: 320 };
  for (const field of Object.keys(windowOptions)) {
    if (window[field] !== undefined) {
      if (!Number.isInteger(window[field]) || window[field] < 200 || window[field] > 16384) {
        throw fieldError('window.' + field, 'debe ser un entero entre 200 y 16384.');
      }
      windowOptions[field] = window[field];
    }
  }
  for (const [field, value] of [
    ['detached', data.detached], ['singleInstance', data.singleInstance],
    ['logOnStart', data.logOnStart], ['window.rememberBounds', window.rememberBounds]
  ]) {
    if (value !== undefined && typeof value !== 'boolean') throw fieldError(field, 'debe ser booleano.');
    if (value === true) throw fieldError(field, 'todavía no está implementado en el prototipo.');
  }
  const baseDir = path.dirname(manifestPath);
  return {
    manifestPath, name: data.name, title: data.title ?? data.name,
    icon: data.icon ? path.resolve(baseDir, data.icon) : undefined,
    command: /[\\/]/.test(command) ? path.resolve(baseDir, command) : command,
    args: data.args ?? [], cwd: path.resolve(baseDir, data.cwd ?? '.'), env,
    port: { mode, name: portName }, ready: { type: 'port', timeoutMs },
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
