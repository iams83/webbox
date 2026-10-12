'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');

class LogWriter extends EventEmitter {
  constructor(directory, { maxBytes = 1024 * 1024, backups = 3, queueLimit = 1024 * 1024 } = {}) {
    super();
    this.filename = path.join(directory, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.log');
    this.maxBytes = maxBytes; this.backups = backups; this.queueLimit = queueLimit;
    this.bytes = 0; this.pending = 0; this.failed = false; this.closed = false;
    this.queue = fs.mkdir(directory, { recursive: true }).catch(error => this.fail(error));
  }
  fail(error) {
    if (this.failed) return;
    this.failed = true;
    this.emit('warning', new Error('No se pudo guardar el log: ' + error.message));
  }
  append(records) {
    if (this.closed || this.failed || !records.length) return;
    const bytes = records.reduce((sum, record) => sum + Buffer.byteLength(record), 0);
    if (this.pending + bytes > this.queueLimit || records.some(record => Buffer.byteLength(record) > this.maxBytes)) {
      this.fail(new Error('se superó el límite de escritura pendiente. El visor sigue disponible.'));
      return;
    }
    this.pending += bytes;
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      let batch = [], batchBytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        await fs.appendFile(this.filename, batch.join(''), 'utf8');
        this.bytes += batchBytes;
        batch = []; batchBytes = 0;
      };
      for (const record of records) {
        const size = Buffer.byteLength(record);
        if (this.bytes + batchBytes + size > this.maxBytes) {
          await flush();
          await this.rotate();
        }
        batch.push(record); batchBytes += size;
      }
      await flush();
    }).catch(error => this.fail(error)).finally(() => { this.pending -= bytes; });
  }
  async rotate() {
    for (let index = this.backups; index >= 1; index--) {
      const target = this.filename + '.' + index;
      await fs.rm(target, { force: true });
      const source = index === 1 ? this.filename : this.filename + '.' + (index - 1);
      try { await fs.rename(source, target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!this.backups) await fs.rm(this.filename, { force: true });
    this.bytes = 0;
  }
  async close() { this.closed = true; await this.queue; }
}

module.exports = { LogWriter };
