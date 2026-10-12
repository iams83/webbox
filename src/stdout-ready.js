'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

if (!isMainThread) {
  const pattern = new RegExp(workerData.pattern);
  let buffer = '';
  parentPort.on('message', text => {
    buffer = (buffer + text).slice(-65536);
    parentPort.postMessage(pattern.test(buffer) ? 'matched' : 'checked');
  });
} else {
  class StdoutReady {
    constructor(pattern) {
      this.matched = false;
      this.error = null;
      this.pending = '';
      this.inFlight = false;
      this.closed = false;
      this.worker = new Worker(__filename, { workerData: { pattern } });
      this.worker.on('message', result => {
        this.inFlight = false;
        if (result === 'matched') this.matched = true;
        else if (this.pending) { const text = this.pending; this.pending = ''; this.push(text); }
      });
      this.worker.on('error', error => { this.error = error; });
    }
    push(text) {
      if (this.matched || this.closed) return;
      if (this.inFlight) { this.pending = (this.pending + text).slice(-65536); return; }
      this.inFlight = true;
      this.worker.postMessage(text.slice(-65536));
    }
    async close() { this.closed = true; this.pending = ''; await this.worker.terminate(); }
  }
  module.exports = { StdoutReady };
}
