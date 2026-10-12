'use strict';

const { EventEmitter } = require('node:events');
const { LogWriter } = require('./log-writer');

const colors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
class LogBuffer extends EventEmitter {
  constructor({ limit = 10000, lineLimit = 4096 } = {}) {
    super();
    this.limit = limit;
    this.lineLimit = lineLimit;
    this.lines = [];
    this.streams = new Map();
    this.sequence = 0;
    this.revision = 0;
    this.diskError = null;
  }

  persist(directory, options) {
    this.writer = new LogWriter(directory, options);
    this.writer.on('warning', error => { this.diskError = error.message; this.changed(); });
  }

  stream(name) {
    if (!this.streams.has(name)) this.streams.set(name, { style: {}, escape: '', mode: 'text', cr: false, line: null });
    return this.streams.get(name);
  }

  line(stream, state) {
    return state.line ??= { id: ++this.sequence, time: new Date().toISOString(), stream, text: '', spans: [], truncated: false };
  }

  sgr(state, sequence) {
    const codes = (sequence || '0').split(';').map(Number);
    for (const code of codes) {
      if (code === 0) state.style = {};
      else if (code === 1) state.style.bold = true;
      else if (code === 22) delete state.style.bold;
      else if (code === 39) delete state.style.color;
      else if (code >= 30 && code <= 37) state.style.color = colors[code - 30];
      else if (code >= 90 && code <= 97) state.style.color = 'bright-' + colors[code - 90];
      // Consumir completos colores extendidos no soportados, sin interpretar
      // sus parámetros como códigos de estilo independientes.
      else if (code === 38 || code === 48) break;
    }
  }

  write(stream, text) {
    const state = this.stream(stream);
    const completed = [];
    for (const char of String(text)) {
      if (state.mode === 'osc') {
        if (char === '\x07' || (state.escape === '\x1b' && char === '\\')) { state.mode = 'text'; state.escape = ''; }
        else state.escape = char === '\x1b' ? char : '';
        continue;
      }
      if (state.mode === 'esc') {
        state.mode = char === '[' ? 'csi' : char === ']' ? 'osc' : 'text';
        state.escape = '';
        continue;
      }
      if (state.mode === 'csi') {
        if (/[\x40-\x7e]/.test(char)) {
          if (char === 'm') this.sgr(state, state.escape);
          state.mode = 'text'; state.escape = '';
        } else if (state.escape.length < 128) state.escape += char;
        continue;
      }
      if (char === '\x1b') { state.mode = 'esc'; continue; }
      if (state.cr) {
        state.cr = false;
        if (char !== '\n' && state.line) { state.line.text = ''; state.line.spans = []; state.line.truncated = false; }
      }
      if (char === '\r') { state.cr = true; continue; }
      const line = this.line(stream, state);
      if (char === '\n') { this.lines.push(line); completed.push(line); state.line = null; continue; }
      if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(char)) continue;
      if (line.text.length + char.length > this.lineLimit) { line.truncated = true; continue; }
      line.text += char;
      const key = (state.style.color ?? '') + ':' + !!state.style.bold;
      let span = line.spans.at(-1);
      if (span?.key !== key) {
        // Acotar fragmentación adversaria: tras 128 cambios conservar texto plano.
        if (line.spans.length >= 128) span = line.spans.at(-1);
        else { span = { key, ...state.style, text: '' }; line.spans.push(span); }
      }
      span.text += char;
    }
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
    this.record(completed);
    this.changed();
  }

  record(lines) {
    this.writer?.append(lines.map(line => `${line.time} [${line.stream}] ${line.text}${line.truncated ? ' [línea truncada]' : ''}\n`));
  }

  flush(stream) {
    const names = stream ? [stream] : [...this.streams.keys()];
    const completed = [];
    for (const name of names) {
      const state = this.streams.get(name);
      if (state?.line) { this.lines.push(state.line); completed.push(state.line); state.line = null; }
      if (state) { state.mode = 'text'; state.escape = ''; state.cr = false; state.style = {}; }
    }
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
    this.record(completed);
    this.changed();
  }

  changed() { this.revision++; this.emit('change'); }
  snapshot() {
    const lines = [...this.lines, ...[...this.streams.values()].map(state => state.line).filter(Boolean)]
      .sort((a, b) => a.id - b.id).slice(-this.limit);
    return { revision: this.revision, lines, diskError: this.diskError };
  }
  clear() {
    this.lines = [];
    // Limpiar el visor no borra el archivo ni pierde el fragmento que sigue llegando.
    for (const state of this.streams.values()) if (state.line) state.line.hidden = true;
    this.hiddenUntil = this.sequence;
    this.changed();
  }
  visibleSnapshot() {
    const data = this.snapshot();
    data.lines = data.lines.filter(line => line.id > (this.hiddenUntil ?? 0));
    return data;
  }
  text() { return this.visibleSnapshot().lines.map(line => `[${line.stream}] ${line.text}${line.truncated ? ' [línea truncada]' : ''}`).join('\n'); }
  tail() { return this.snapshot().lines.map(line => `[${line.stream}] ${line.text}\n`).join('').slice(-12000); }
  async close() { this.flush(); await this.writer?.close(); }
}

module.exports = { LogBuffer };
