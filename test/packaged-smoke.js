'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { app } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');

const archive = path.resolve(process.argv[2] ?? path.resolve(__dirname, '../dist/win-unpacked/resources/app.asar'));
const artifacts = path.resolve(__dirname, '../artifacts/package');
app.setPath('userData', path.join(artifacts, 'profile'));
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let instance;
  const timer = setTimeout(() => app.exit(1), 30000);
  try {
    // Usa el código, dependencias y web del ASAR final, sin fuentes externas.
    const { Launcher } = require(path.join(archive, 'src/launcher.js'));
    instance = new Launcher({ show: false });
    await instance.start([path.join(archive, 'embedded/app.app.json')]);
    assert.equal(instance.state, 'running', instance.error?.message);
    const contents = instance.webView.webContents;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !(await contents.executeJavaScript('document.querySelector("#result")?.textContent === "JavaScript estático activo."'))) await delay(50);
    assert.equal(await contents.executeJavaScript('document.querySelector("#result")?.textContent'), 'JavaScript estático activo.', 'El módulo de la demo debe ejecutarse desde el ASAR.');
    const result = await contents.executeJavaScript(`({
      text: document.body.innerText, title: document.title,
      node: typeof require, subtle: !!globalThis.crypto?.subtle,
      background: getComputedStyle(document.body).backgroundColor
    })`);
    assert.match(result.text, /Tu web estática/);
    assert.equal(result.title, 'WebBox estático');
    assert.equal(result.node, 'undefined');
    assert.equal(result.subtle, true);
    assert.equal(result.background, 'rgb(245, 247, 251)');
    await fs.mkdir(artifacts, { recursive: true });
    let capture = 'unavailable';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const image = await contents.capturePage(undefined, { stayAwake: true });
        assert.equal(image.isEmpty(), false);
        await fs.writeFile(path.join(artifacts, 'static-demo.png'), image.toPNG());
        capture = 'captured';
        break;
      } catch (error) {
        if (error.message !== 'UnknownVizError') throw error;
        await delay(300);
      }
    }
    await fs.writeFile(path.join(artifacts, 'asar-results.json'), JSON.stringify({
      date: new Date().toISOString(), result: 'passed', archive, title: result.title, capture,
      checks: ['HTML, CSS y módulo de la demo desde ASAR', 'Web Crypto disponible', 'Node aislado']
    }, null, 2));
    console.log('PASS demo estática desde ASAR: recursos, aislamiento y Web Crypto');
    await instance.close();
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    console.error(error);
    await instance?.close();
    app.exit(1);
  }
});
