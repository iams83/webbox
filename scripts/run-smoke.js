'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const electronPath = require('electron');
const checks = require('../test/smoke-checks.json');

function run(script, reportName, expectedChecks) {
  return new Promise((resolve, reject) => {
    const runId = randomUUID();
    const startedAt = Date.now();
    const env = { ...process.env, WEBBOX_TEST_NODE: process.execPath, WEBBOX_TEST_RUN_ID: runId, WEBBOX_REQUIRE_CAPTURES: process.argv.includes('--require-captures') ? '1' : '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, [path.join(__dirname, '../test', script)], {
      env, windowsHide: true, stdio: 'inherit'
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error('La prueba ' + script + ' excedió 210 segundos.');
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill('SIGKILL'));
        killer.on('exit', code => { if (code !== 0) child.kill('SIGKILL'); });
      } else child.kill('SIGKILL');
    }, 210000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (timedOut || code !== 0) {
        reject(new Error('Falló ' + script + ' (código ' + code + ').'));
        return;
      }
      try {
        const result = JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts/smoke', reportName), 'utf8'));
        const date = Date.parse(result.date);
        if (result.runId !== runId || !Number.isFinite(date) || date < startedAt
          || !Array.isArray(result.checks) || result.checks.length !== expectedChecks.length
          || result.checks.some((check, index) => check.name !== expectedChecks[index] || check.result !== 'passed')) {
          throw new Error('El informe no contiene las comprobaciones completas de esta ejecución.');
        }
        resolve();
      } catch (error) {
        reject(new Error('Smoke test incompleto: ' + error.message));
      }
    });
  });
}

(async () => {
  await run('electron-smoke.js', 'results.json', checks);
  await run('main-smoke.js', 'main-results.json', ['entrada real y before-quit terminan el árbol del servidor']);
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
