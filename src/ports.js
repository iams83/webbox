'use strict';

const net = require('node:net');
const path = require('node:path');
const { execFile } = require('node:child_process');

function portConflict(message) {
  return Object.assign(new Error(message), { code: 'EADDRINUSE' });
}

function reservePort(requested = 0) {
  return new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.once('error', reject);
    reservation.listen({ port: requested, host: '127.0.0.1', exclusive: true }, () => {
      const port = reservation.address().port;
      reservation.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function selectPort(options, signal) {
  signal.throwIfAborted();
  if (options.fixed !== undefined) {
    try { return await reservePort(options.fixed); }
    catch (error) {
      if (error.code === 'EADDRINUSE') throw portConflict(`El puerto fijo ${options.fixed} está ocupado.`);
      throw error;
    }
  }
  if (!options.range) return reservePort();
  const [first, last] = options.range;
  for (let port = first; port <= last; port++) {
    signal.throwIfAborted();
    try { return await reservePort(port); }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw portConflict(`No hay puertos libres en el rango ${first}–${last}.`);
}

// El extremo remoto :0 identifica listeners sin depender del idioma de Windows.
function parseListeners(output, port) {
  return output.split(/\r?\n/).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 5 || fields[0] !== 'TCP' || fields[2] !== '0.0.0.0:0'
      || !/^\d+$/.test(fields[4])) return [];
    const match = /^(127\.0\.0\.1|0\.0\.0\.0):(\d+)$/.exec(fields[1]);
    return match && Number(match[2]) === port ? [{ host: match[1], pid: Number(fields[4]) }] : [];
  });
}

function listenerOwner(port, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'netstat.exe');
    // -p tcp limita a IPv4. No se usa shell ni resolución de nombres.
    execFile(command, ['-a', '-n', '-o', '-p', 'tcp'], {
      windowsHide: true, signal, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024
    }, (error, stdout) => {
      if (signal?.aborted) return reject(signal.reason);
      if (error) return reject(new Error('No se pudo comprobar el propietario del puerto: ' + error.message));
      const listeners = parseListeners(stdout, port);
      // Un listener wildcard también atiende 127.0.0.1, pero incumple el contrato.
      resolve(listeners.find(item => item.host === '127.0.0.1') ?? listeners[0] ?? null);
    });
  });
}

module.exports = { reservePort, selectPort, listenerOwner, parseListeners, portConflict };
