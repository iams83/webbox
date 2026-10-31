'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { LogBuffer } = require('./log-buffer');
const { portConflict } = require('./ports');

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.webmanifest': 'application/manifest+json'
};

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

class StaticServer extends EventEmitter {
  constructor(manifest, logs = new LogBuffer()) {
    super();
    this.manifest = manifest;
    this.logs = logs;
    this.port = null;
    this.ready = false;
    this.failure = null;
    this.stopping = false;
    this.controller = new AbortController();
  }

  log(stream, text) {
    this.logs.write(stream, text);
    this.emit('log', { stream, text });
  }

  tail() { return this.logs.tail(); }

  start() {
    this.startPromise ??= this.startInternal();
    return this.startPromise;
  }

  async startInternal() {
    const signal = this.controller.signal;
    const timer = setTimeout(() => this.controller.abort(new Error('Tiempo agotado al iniciar el servidor estático.')), this.manifest.ready.timeoutMs);
    try {
      signal.throwIfAborted();
      this.root = await fsp.realpath(this.manifest.static.root);
      if (!(await fsp.stat(this.root)).isDirectory()) throw new Error('static.root debe ser una carpeta.');
      signal.throwIfAborted();
      this.http = http.createServer((request, response) => {
        void this.serve(request, response).catch(error => {
          if (!this.stopping) this.log('stderr', '[WebBox] Error al servir un archivo: ' + error.message + '\n');
          response.destroy();
        });
      });
      this.http.on('error', error => {
        if (this.stopping || !this.ready) return;
        this.failure = error;
        this.log('stderr', '[WebBox] ' + error.message + '\n');
        this.emit('down', error);
      });
      const { fixed, range } = this.manifest.port;
      const first = fixed ?? range?.[0] ?? 0;
      const last = fixed ?? range?.[1] ?? 0;
      for (let port = first; port <= last; port++) {
        signal.throwIfAborted();
        try {
          await new Promise((resolve, reject) => {
            const onError = error => { cleanup(); reject(error); };
            const onListen = () => { cleanup(); resolve(); };
            const onAbort = () => { cleanup(); reject(signal.reason); };
            const cleanup = () => {
              this.http.off('error', onError);
              this.http.off('listening', onListen);
              signal.removeEventListener('abort', onAbort);
            };
            this.http.once('error', onError);
            this.http.once('listening', onListen);
            signal.addEventListener('abort', onAbort, { once: true });
            this.http.listen({ host: '127.0.0.1', port, exclusive: true, signal });
          });
          break;
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          if (error.code === 'EADDRINUSE' && fixed !== undefined) throw portConflict(`El puerto fijo ${fixed} está ocupado.`);
          if (error.code !== 'EADDRINUSE' || port === last) throw error;
        }
      }
      signal.throwIfAborted();
      this.port = this.http.address().port;
      this.ready = true;
      this.log('stdout', `[WebBox] Web estática integrada en http://127.0.0.1:${this.port}\n`);
      return `http://127.0.0.1:${this.port}${this.manifest.startUrl}`;
    } catch (error) {
      this.failure = error;
      if (this.http?.listening) await new Promise(resolve => this.http.close(resolve));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async serve(request, response) {
    const reply = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return reply(405, 'Método no permitido.');
    }
    if (![ `127.0.0.1:${this.port}`, `localhost:${this.port}` ].includes(request.headers.host)) return reply(403, 'Host no permitido.');
    let pathname;
    try { pathname = decodeURIComponent(request.url.split('?')[0]); }
    catch { return reply(400, 'Ruta no válida.'); }
    if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\:\u0000-\u001f\u007f]/.test(pathname)
      || pathname.split('/').some(part => part.startsWith('.'))) return reply(403, 'Ruta no permitida.');
    let filename = path.resolve(this.root, '.' + pathname);
    if (!inside(this.root, filename)) return reply(403, 'Ruta no permitida.');
    let stat;
    try {
      filename = await fsp.realpath(filename);
      if (!inside(this.root, filename)) return reply(403, 'Ruta no permitida.');
      stat = await fsp.stat(filename);
      if (stat.isDirectory()) {
        // La barra final conserva la base de los recursos relativos de cada índice.
        if (!pathname.endsWith('/')) {
          response.writeHead(301, { Location: encodeURI(pathname).replace(/[?#]/g, char => encodeURIComponent(char)) + '/' });
          return response.end();
        }
        filename = await fsp.realpath(path.join(filename, 'index.html'));
        if (!inside(this.root, filename)) return reply(403, 'Ruta no permitida.');
        stat = await fsp.stat(filename);
      }
      if (!stat.isFile()) return reply(404, 'Archivo no encontrado.');
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EINVAL'].includes(error.code)) return reply(404, 'Archivo no encontrado.');
      throw error;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache'
    });
    if (request.method === 'HEAD') return response.end();
    try { await pipeline(fs.createReadStream(filename), response); }
    catch (error) { if (!response.destroyed) throw error; }
  }

  stop() {
    this.stopping = true;
    this.controller.abort(new Error('Servidor estático detenido.'));
    this.stopPromise ??= (async () => {
      await this.startPromise?.catch(() => {});
      if (this.http) {
        await new Promise(resolve => {
          this.http.close(resolve);
          this.http.closeAllConnections();
        });
      }
      this.ready = false;
    })();
    return this.stopPromise;
  }
}

module.exports = { StaticServer };
