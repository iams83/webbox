'use strict';

const terminal = new Terminal({
  disableStdin: true, convertEol: true, scrollback: 10000, fontSize: 13,
  fontFamily: 'Consolas, "Cascadia Mono", monospace', cursorBlink: false,
  theme: { background: '#101724', foreground: '#c9d6e8', red: '#f38c8c', green: '#91d9a5', yellow: '#f4cf8c', blue: '#87b6f8', brightBlack: '#9aaac0' }
});
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit);
terminal.open(document.getElementById('terminal'));
terminal.attachCustomKeyEventHandler(event => event.key !== 'F12');
// Referencia local al visor, sin exponerla a la web ni conectar stdin al servidor.
window.logTerminal = terminal;
let paused = false;
let latest = null;
let writing = false;
let painted = -1;
const colors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
function code(span, stream) {
  const bright = span.color?.startsWith('bright-');
  const index = colors.indexOf(span.color?.replace('bright-', ''));
  return '\x1b[0;' + (span.bold ? '1;' : '') + (index >= 0 ? (bright ? 90 : 30) + index : stream === 'stderr' ? 31 : 37) + 'm';
}
async function render() {
  if (writing || !latest) return;
  if (latest.revision === painted) { window.webboxLog.rendered(latest.packet); return; }
  const data = latest;
  const top = terminal.buffer.active.viewportY;
  const value = data.lines.map(line => '\x1b[0;90m' + line.time.slice(11, 19) + ' [' + line.stream + '] ' +
    line.spans.map(span => code(span, line.stream) + span.text).join('') +
    (line.truncated ? '\x1b[0;33m [línea truncada]' : '') + '\x1b[0m').join('\r\n');
  writing = true;
  terminal.reset();
  try {
    // Esperar al parser de xterm entre bloques; evitar su cola de 50 MB.
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(offset + 65536, value.length);
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
      await new Promise(resolve => terminal.write(value.slice(offset, end), resolve));
      offset = end;
    }
    painted = data.revision;
    if (paused) terminal.scrollToLine(top); else terminal.scrollToBottom();
  } finally {
    writing = false;
    window.webboxLog.rendered(data.packet);
    if (latest.packet !== data.packet) render();
  }
}
window.webboxLog.subscribe(data => {
  if (latest && data.revision < latest.revision) return;
  latest = data;
  document.getElementById('title').textContent = data.title;
  const state = document.getElementById('state');
  state.textContent = data.state === 'running' ? 'Activo' : data.state === 'error' ? 'Caído' : 'Arrancando';
  state.dataset.state = data.state;
  document.getElementById('count').textContent = data.lines.length + ' / 10000 líneas';
  document.getElementById('notice').textContent = data.diskError || data.message || '';
  render();
});
document.getElementById('clear').addEventListener('click', () => window.webboxLog.clear());
document.getElementById('copy').addEventListener('click', () => window.webboxLog.copy());
document.getElementById('pause').addEventListener('click', event => {
  paused = !paused;
  event.target.setAttribute('aria-pressed', String(paused));
  event.target.textContent = paused ? 'Reanudar autoscroll' : 'Pausar autoscroll';
  if (!paused) terminal.scrollToBottom();
});
new ResizeObserver(() => { fit.fit(); if (!paused) terminal.scrollToBottom(); }).observe(document.getElementById('terminal'));
window.addEventListener('focus', () => terminal.focus());
