'use strict';

const net = require('node:net');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

function reservePort() {
  return new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port;
      reservation.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForClose(promise, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    promise.then(() => { clearTimeout(timer); resolve(true); });
  });
}

function isPortOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

class LocalServer extends EventEmitter {
  constructor(manifest) {
    super();
    this.manifest = manifest;
    this.lines = [];
    this.child = null;
    this.failure = null;
    this.stopping = false;
    this.port = null;
    this.ready = false;
    this.exitPromise = null;
    this.stopPromise = null;
  }

  log(stream, text) {
    this.lines.push({ stream, text });
    // Buffer preliminar; la separación en líneas y rotación llegan en el hito 4.
    if (this.lines.length > 200) this.lines.shift();
    this.emit('log', { stream, text });
  }

  async start() {
    const manifest = this.manifest;
    this.port = await reservePort();
    if (this.stopping) throw new Error('Arranque cancelado.');
    const replacePort = value => value.replaceAll('{PORT}', String(this.port));
    const env = { ...process.env };
    // Electron usa esta variable durante las pruebas; no debe heredarse al servidor.
    delete env.ELECTRON_RUN_AS_NODE;
    for (const [key, value] of Object.entries(manifest.env)) env[key] = replacePort(value);
    env[manifest.port.name] = String(this.port);
    const child = spawn(manifest.command, manifest.args.map(replacePort), {
      cwd: manifest.cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child = child;
    this.exitPromise = new Promise(resolve => child.once('close', resolve));
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', text => this.log(stream, text));
    }
    child.once('error', error => {
      this.failure = error.code === 'ENOENT'
        ? new Error(`No se pudo ejecutar «${manifest.command}». Comprueba que el runtime esté instalado y en PATH, y que cwd exista (${manifest.cwd}).`)
        : new Error(`No se pudo ejecutar «${manifest.command}»: ${error.message}`);
      if (this.ready && !this.stopping) this.emit('down', this.failure);
    });
    child.once('exit', (code, signal) => {
      this.failure ??= new Error(code === 0 && !this.ready
        ? 'El servidor terminó con código 0 antes de estar listo. Quizá se desprende a segundo plano; el soporte detached llegará en el hito 2.'
        : `El servidor terminó (${signal ? `señal ${signal}` : `código ${code}`}).`);
      if (this.ready && !this.stopping) this.emit('down', this.failure);
    });
    const deadline = Date.now() + manifest.ready.timeoutMs;
    while (Date.now() < deadline) {
      if (this.stopping) throw new Error('Arranque cancelado.');
      if (this.failure) throw this.failure;
      if (await isPortOpen(this.port)) {
        if (this.failure) throw this.failure;
        if (this.stopping) throw new Error('Arranque cancelado.');
        this.ready = true;
        return `http://127.0.0.1:${this.port}${manifest.startUrl}`;
      }
      await delay(100);
    }
    throw new Error(`El servidor no abrió el puerto ${this.port} en ${manifest.ready.timeoutMs} ms.`);
  }

  stop() {
    this.stopping = true;
    this.stopPromise ??= this.stopDirectChild();
    return this.stopPromise;
  }

  async stopDirectChild(timeoutMs = 3000) {
    // En Windows kill() es forzado. Árbol y apagado suave siguen pendientes.
    if (!this.child || !this.exitPromise) return;
    let killError;
    const kill = signal => {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        try {
          if (!this.child.kill(signal)) killError = new Error('El sistema no confirmó la terminación.');
        } catch (error) { killError = error; }
      }
    };
    kill();
    if (await waitForClose(this.exitPromise, timeoutMs)) return;
    kill('SIGKILL');
    // Un descendiente podría conservar los pipes aunque el proceso directo haya salido.
    this.child.stdout?.destroy();
    this.child.stderr?.destroy();
    if (await waitForClose(this.exitPromise, timeoutMs)) return;
    throw new Error('No se pudo confirmar el cierre del proceso ' + this.child.pid + ' en ' + (2 * timeoutMs) + ' ms.' + (killError ? ' ' + killError.message : ''));
  }

  tail() {
    return this.lines.map(line => `[${line.stream}] ${line.text}`).join('').slice(-12000);
  }
}

module.exports = { LocalServer, reservePort, isPortOpen };
