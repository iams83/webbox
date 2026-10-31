'use strict';

const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { reservePort, selectPort, listenerOwner, portConflict } = require('./ports');
const { resolveRuntime, setEnv } = require('./runtimes');
const { processSnapshot, relatedProcesses, killTree } = require('./processes');
const { StdoutReady } = require('./stdout-ready');
const { LogBuffer } = require('./log-buffer');

function waitForClose(promise, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    promise.then(() => { clearTimeout(timer); resolve(true); });
  });
}

function isPortOpen(port, signal, timeoutMs = 250) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      resolve(result);
    };
    const abort = () => finish(false);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

function httpReady(port, readyPath, signal, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const request = http.get(new URL(readyPath, `http://127.0.0.1:${port}`), { agent: false, signal }, response => {
      // Solo las cabeceras: no esperamos cuerpos lentos ni seguimos redirecciones.
      finish({ ready: response.statusCode >= 200 && response.statusCode < 300, detail: `HTTP ${response.statusCode}` });
      response.destroy();
    });
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(result);
    };
    request.on('error', () => finish({ ready: false, detail: 'sin respuesta HTTP' }));
    timer = setTimeout(() => finish({ ready: false, detail: 'sin respuesta HTTP' }), timeoutMs);
  });
}

class LocalServer extends EventEmitter {
  constructor(manifest, logs = new LogBuffer(), appArgs = []) {
    super();
    this.manifest = manifest;
    this.appArgs = [...appArgs];
    this.logs = logs;
    this.child = null;
    this.failure = null;
    this.stopping = false;
    this.port = null;
    this.ready = false;
    this.exitPromise = null;
    this.stopPromise = null;
    this.childStopPromise = null;
    this.startPromise = null;
    this.startController = new AbortController();
    this.attempts = 0;
    this.knownProcesses = new Map();
    this.listenerPid = null;
    this.monitorController = null;
    this.monitorPromise = null;
  }

  log(stream, text) {
    this.logs.write(stream, text);
    this.emit('log', { stream, text });
  }

  start() {
    this.startPromise ??= this.startInternal();
    return this.startPromise;
  }

  selectPort() {
    return selectPort(this.manifest.port, this.startController.signal);
  }

  async startInternal() {
    const signal = this.startController.signal;
    const deadline = Date.now() + this.manifest.ready.timeoutMs;
    const timer = setTimeout(() => this.startController.abort(this.timeoutError()), this.manifest.ready.timeoutMs);
    try {
      // Un intento inicial y, únicamente ante conflictos, hasta tres reintentos.
      for (let attempt = 0; attempt < 4; attempt++) {
        signal.throwIfAborted();
        this.failure = null;
        this.conflictOutput = '';
        this.httpDetail = null;
        this.childExitedAt = null;
        this.knownProcesses.clear();
        this.listenerPid = null;
        this.child = null;
        this.exitPromise = null;
        this.childStopPromise = null;
        this.runtime = null;
        try {
          this.port = await this.selectPort();
          signal.throwIfAborted();
          this.attempts++;
          await this.prepareRuntime();
          signal.throwIfAborted();
          if (this.manifest.ready.type === 'stdout') this.stdoutReady = new StdoutReady(this.manifest.ready.pattern);
          this.spawnServer();
          const url = await this.waitUntilReady(deadline);
          if (this.manifest.detached) this.startMonitor();
          return url;
        } catch (error) {
          const failure = signal.aborted ? signal.reason : error;
          await this.stopDirectChild();
          if (error.code !== 'EADDRINUSE' && !/\bEADDRINUSE\b/.test(this.conflictOutput)) throw failure;
          signal.throwIfAborted();
          const conflict = portConflict(`Conflicto de puerto: ${error.code === 'EADDRINUSE' ? error.message : `el servidor no pudo escuchar en ${this.port}.`}`);
          if (attempt === 3) throw portConflict(conflict.message + ' Se agotaron los tres reintentos.');
          this.log('stderr', `[WebBox] ${conflict.message} Reintento ${attempt + 1}/3.\n`);
          await delay(Math.min(100, Math.max(1, deadline - Date.now())), undefined, { signal });
        } finally {
          await this.stdoutReady?.close();
          this.stdoutReady = null;
        }
      }
    } catch (error) {
      throw signal.aborted && error.name === 'AbortError' ? signal.reason : error;
    } finally {
      clearTimeout(timer);
    }
  }

  timeoutError() {
    const timeoutMs = this.manifest.ready.timeoutMs;
    if (this.manifest.ready.type === 'http') {
      return new Error(`El servidor no estuvo listo por HTTP en ${timeoutMs} ms (${this.manifest.ready.path}; ${this.httpDetail ?? 'sin respuesta HTTP'}).`);
    }
    if (this.manifest.ready.type === 'stdout') return new Error(`El servidor no emitió el patrón stdout y abrió su puerto en ${timeoutMs} ms.`);
    return new Error(`El servidor no abrió el puerto ${this.port ?? 'asignado'} en ${timeoutMs} ms.`);
  }

  async prepareRuntime() {
    const manifest = this.manifest;
    if (manifest.port.mode === 'arg' && this.appArgs.some(arg => arg === manifest.port.name || arg.startsWith(manifest.port.name + '='))) {
      throw new Error('Los argumentos de la aplicación ya contienen ' + manifest.port.name + '; WebBox lo añade automáticamente.');
    }
    const replacePort = value => value.replaceAll('{PORT}', String(this.port));
    const env = { ...process.env };
    // Electron usa esta variable durante las pruebas; no debe heredarse al servidor.
    setEnv(env, 'ELECTRON_RUN_AS_NODE', undefined);
    for (const [key, value] of Object.entries(manifest.env)) setEnv(env, key, replacePort(value));
    let args = manifest.args.map(replacePort);
    if (manifest.port.mode === 'env') setEnv(env, manifest.port.name, String(this.port));
    else {
      // PORT heredado no debe ocultar errores del contrato arg/placeholder.
      if (!Object.keys(manifest.env).some(key => key.toUpperCase() === 'PORT')) setEnv(env, 'PORT', undefined);
      if (manifest.port.mode === 'arg') args = [...args, manifest.port.name, String(this.port)];
    }
    // Los argumentos recibidos se conservan literalmente, incluido un posible {PORT}.
    this.runtime = await resolveRuntime(manifest.command, [...args, ...this.appArgs], env, manifest.cwd, this.startController.signal);
    this.runtime.env = env;
    this.log('stdout', '[WebBox] Runtime: ' + this.runtime.label + '\n');
  }

  spawnServer() {
    const manifest = this.manifest;
    this.childStartedAt = Date.now();
    const child = spawn(this.runtime.command, this.runtime.args, {
      cwd: manifest.cwd,
      env: this.runtime.env,
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: this.runtime.windowsVerbatimArguments ?? false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child = child;
    this.childStopPromise = null;
    this.exitPromise = new Promise(resolve => child.once('close', resolve));
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].once('end', () => this.logs.flush(stream));
      child[stream].on('data', text => {
        if (stream === 'stderr') this.conflictOutput = (this.conflictOutput + text).slice(-4000);
        if (stream === 'stdout') this.stdoutReady?.push(text);
        this.log(stream, text);
      });
    }
    child.once('error', error => {
      this.failure = error.code === 'ENOENT'
        ? new Error(`No se pudo ejecutar «${manifest.command}». Comprueba que el runtime esté instalado y en PATH, y que cwd exista (${manifest.cwd}).`)
        : new Error(`No se pudo ejecutar «${manifest.command}»: ${error.message}`);
      if (this.ready && !this.stopping) this.emit('down', this.failure);
    });
    child.once('exit', (code, signal) => {
      this.childExitedAt = Date.now();
      if (manifest.detached && code === 0) return;
      this.failure ??= new Error(code === 0 && !this.ready
        ? 'El servidor terminó con código 0 antes de estar listo. Quizá se desprende a segundo plano; configura detached: true con readiness port o http.'
        : `El servidor terminó (${signal ? `señal ${signal}` : `código ${code}`}).`);
      if (this.ready && !this.stopping) this.emit('down', this.failure);
    });
  }

  async verifyOwner(deadline) {
    const signal = this.startController.signal;
    const owner = await listenerOwner(this.port, signal, Math.max(1, Math.min(1500, deadline - Date.now())));
    signal.throwIfAborted();
    if (!owner) return false;
    if (owner.pid !== this.child.pid) {
      const rows = await processSnapshot(signal, Math.max(1, Math.min(3000, deadline - Date.now())));
      const related = this.adoptProcesses(rows);
      if (!related.some(row => row.pid === owner.pid)) throw portConflict(`El puerto ${this.port} pertenece a otro proceso (PID ${owner.pid}).`);
    }
    if (owner.host !== '127.0.0.1') throw new Error('El servidor debe escuchar solo en 127.0.0.1; se detectó 0.0.0.0.');
    if (this.failure) throw this.failure;
    this.listenerPid = owner.pid;
    return true;
  }

  adoptProcesses(rows) {
    const related = relatedProcesses(rows, { pid: this.child.pid, born: this.childStartedAt, until: this.childExitedAt ?? Infinity }, this.knownProcesses);
    for (const row of related) if (row.pid !== this.child.pid) this.knownProcesses.set(row.pid, { ...row, seenAt: Date.now() });
    return related;
  }

  startMonitor() {
    this.monitorController = new AbortController();
    const signal = this.monitorController.signal;
    this.monitorPromise = (async () => {
      try {
        while (!signal.aborted) {
          await delay(500, undefined, { signal });
          const owner = await listenerOwner(this.port, signal, 1500);
          if (!owner || owner.pid !== this.listenerPid || owner.host !== '127.0.0.1' || !await isPortOpen(this.port, signal)) {
            throw new Error(`El servidor detached dejó de escuchar en 127.0.0.1:${this.port} o cambió de propietario.`);
          }
        }
      } catch (error) {
        if (!signal.aborted && !this.stopping) { this.failure = error; this.emit('down', error); }
      }
    })();
  }

  async waitUntilReady(deadline) {
    const manifest = this.manifest;
    const signal = this.startController.signal;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (this.failure) throw this.failure;
      if (this.stdoutReady?.error) throw this.stdoutReady.error;
      if (manifest.ready.type === 'stdout' && !this.stdoutReady.matched) {
        await delay(100, undefined, { signal });
        continue;
      }
      if (await isPortOpen(this.port, signal, Math.max(1, Math.min(250, deadline - Date.now()))) && await this.verifyOwner(deadline)) {
        if (manifest.ready.type === 'http') {
          const result = await httpReady(this.port, manifest.ready.path, signal, Math.max(1, Math.min(1000, deadline - Date.now())));
          this.httpDetail = result.detail;
          signal.throwIfAborted();
          if (this.failure) throw this.failure;
          if (!result.ready) {
            await delay(100, undefined, { signal });
            continue;
          }
          if (!await this.verifyOwner(deadline)) continue;
        }
        if (this.failure) throw this.failure;
        signal.throwIfAborted();
        if (Date.now() >= deadline) break;
        this.ready = true;
        return `http://127.0.0.1:${this.port}${manifest.startUrl}`;
      }
      await delay(100, undefined, { signal });
    }
    throw this.timeoutError();
  }

  stop() {
    this.stopping = true;
    this.startController.abort(new Error('Arranque cancelado.'));
    this.monitorController?.abort();
    this.stopPromise ??= (async () => {
      await this.startPromise?.catch(() => {});
      await this.monitorPromise;
      await this.stopDirectChild();
    })();
    return this.stopPromise;
  }

  stopDirectChild(timeoutMs = 3000) {
    this.childStopPromise ??= this.terminateDirectChild(timeoutMs);
    return this.childStopPromise;
  }

  async terminateDirectChild(timeoutMs) {
    // En Windows kill() es forzado; el apagado suave llega en el hito 5.
    if (!this.child || !this.exitPromise) return;
    let treeError;
    if (this.child.pid) {
      try { await this.terminateTree(timeoutMs); }
      catch (error) { treeError = error; }
    }
    let killError;
    const kill = signal => {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        try {
          if (!this.child.kill(signal)) killError = new Error('El sistema no confirmó la terminación.');
        } catch (error) { killError = error; }
      }
    };
    kill();
    if (await waitForClose(this.exitPromise, timeoutMs)) {
      if (treeError) throw treeError;
      return;
    }
    kill('SIGKILL');
    // Un descendiente podría conservar los pipes aunque el proceso directo haya salido.
    this.child.stdout?.destroy();
    this.child.stderr?.destroy();
    if (await waitForClose(this.exitPromise, timeoutMs)) {
      if (treeError) throw treeError;
      return;
    }
    throw new Error('No se pudo confirmar el cierre del proceso ' + this.child.pid + ' en ' + (2 * timeoutMs) + ' ms.' + (killError ? ' ' + killError.message : ''));
  }

  async terminateTree(timeoutMs) {
    const deadline = Date.now() + 2 * timeoutMs;
    const remainingTime = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Se agotó el plazo de cierre del árbol del servidor.');
      return Math.min(timeoutMs, remaining);
    };
    // Volver a consultar el puerto nunca basta para adoptar a su propietario:
    // puede haber sido ocupado por un servicio ajeno desde el arranque.
    const owner = this.port ? await listenerOwner(this.port, undefined, remainingTime()) : null;
    const rows = await processSnapshot(undefined, remainingTime());
    const related = this.adoptProcesses(rows);
    if (owner && related.some(row => row.pid === owner.pid)) this.listenerPid = owner.pid;
    const ids = new Set(related.map(row => row.pid));
    // taskkill /T cubre cada raíz viva; si el padre inicial salió, el listener
    // y otros descendientes observados pasan a ser raíces independientes.
    for (const row of related.filter(row => !ids.has(row.parent))) await killTree(row.pid, remainingTime());
    this.child.stdout?.destroy();
    this.child.stderr?.destroy();
    const remaining = await processSnapshot(undefined, remainingTime());
    if (remaining.some(row => related.some(old => old.pid === row.pid && old.born === row.born))) {
      throw new Error('No se pudo confirmar el cierre del árbol del servidor.');
    }
  }

  tail() {
    return this.logs.tail();
  }
}

module.exports = { LocalServer, reservePort, isPortOpen };
