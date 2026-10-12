'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow } = require('electron');
const { isPortOpen } = require('../src/server');

const artifacts = path.join(__dirname, '../artifacts/smoke');
const profile = path.join(artifacts, 'main-profile-' + process.env.WEBBOX_TEST_RUN_ID);
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const serverInfo = path.join(profile, 'server-info.json');
const manifestFile = path.join(profile, 'entry.app.json');
fs.writeFileSync(manifestFile, JSON.stringify({
  name: 'Main smoke ' + process.env.WEBBOX_TEST_RUN_ID, command: process.env.WEBBOX_TEST_NODE,
  args: [path.join(__dirname, '../examples/process-tree/server.js')], env: { WEBBOX_TREE_INFO: serverInfo },
  ready: { type: 'http', path: '/pids', timeoutMs: 15000 }
}));
process.argv = [process.argv[0], path.join(__dirname, '..'), manifestFile];
let failure;
let verified = false;
const deadline = setTimeout(() => { console.error('Main smoke excedió 20 segundos'); app.exit(1); }, 20000);

// Ejecuta exactamente el bootstrap de producción, incluidos los listeners de salida.
require('../src/main');

app.on('will-quit', () => {
  clearTimeout(deadline);
  try {
    assert.equal(verified, true, failure?.stack);
    const info = JSON.parse(fs.readFileSync(serverInfo, 'utf8'));
    assert.equal(info.pids.length, 3);
    for (const pid of info.pids) assert.throws(() => process.kill(pid, 0));
    fs.writeFileSync(path.join(artifacts, 'main-results.json'), JSON.stringify({
      date: new Date().toISOString(), runId: process.env.WEBBOX_TEST_RUN_ID,
      checks: [{ name: 'entrada real y before-quit terminan el árbol del servidor', result: 'passed' }]
    }, null, 2));
    console.log('PASS entrada real y before-quit terminan el árbol del servidor');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    app.exit(1);
  }
});

app.whenReady().then(async () => {
  try {
    const end = Date.now() + 10000;
    let contents;
    while (Date.now() < end) {
      contents = BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.webContents;
      if (contents && !contents.isDestroyed() && !contents.isLoading() && contents.getURL().startsWith('http://127.0.0.1:')) break;
      await delay(25);
    }
    assert.ok(contents && !contents.isDestroyed());
    assert.match(await contents.executeJavaScript('document.body.textContent'), /Tu web, en una ventana/);
    const info = JSON.parse(fs.readFileSync(serverInfo, 'utf8'));
    assert.equal(await isPortOpen(info.port), true);
    verified = true;
  } catch (error) { failure = error; }
  app.quit();
});
