'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createHash } = require('node:crypto');
const { processSnapshot, relatedProcesses, killTree } = require('../src/processes');
const { isPortOpen } = require('../src/server');
const exec = promisify(execFile);
const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

async function main() {
  const executable = path.resolve(process.argv[2] ?? path.resolve(__dirname, `../dist/webbox-demo-${require('../package.json').version}-win-x64.exe`));
  const expectedTitle = process.argv[3] ?? 'WebBox Demo';
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox portable España '));
  let child, exited, owner, port;
  try {
    const portable = path.join(directory, path.basename(executable));
    await fs.copyFile(executable, portable);
    assert.deepEqual(await fs.readdir(directory), [path.basename(executable)]);
    const env = { ...process.env, Path: system32 + ';' + path.dirname(system32) };
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'path' && key !== 'Path' || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
    }
    const started = Date.now();
    child = spawn(portable, [], { cwd: directory, env, windowsHide: true, stdio: 'ignore' });
    exited = once(child, 'exit');
    exited.catch(() => {});
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const rows = await processSnapshot(undefined, 5000);
      const related = relatedProcesses(rows, { pid: child.pid, born: started - 1000 });
      const ids = new Set(related.map(row => row.pid));
      const { stdout } = await exec(path.join(system32, 'netstat.exe'), ['-a', '-n', '-o', '-p', 'tcp'], { windowsHide: true });
      for (const line of stdout.split(/\r?\n/)) {
        const fields = line.trim().split(/\s+/);
        const match = /^127\.0\.0\.1:(\d+)$/.exec(fields[1] ?? '');
        if (match && fields[2] === '0.0.0.0:0' && ids.has(Number(fields[4]))) {
          port = Number(match[1]); owner = Number(fields[4]);
          break;
        }
      }
      if (port) break;
      if (child.exitCode !== null) throw new Error('El portable terminó antes de abrir el servidor.');
      await delay(200);
    }
    assert.ok(port, 'El portable no abrió su servidor integrado.');
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/i);
    const html = await response.text();
    assert.ok(html.trim(), 'El servidor debe entregar el HTML empaquetado.');
    const { stdout: title } = await exec(path.join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${owner}).MainWindowTitle`], { windowsHide: true });
    assert.equal(title.trim(), expectedTitle);
    await exec(path.join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', `if (-not (Get-Process -Id ${owner}).CloseMainWindow()) { exit 1 }`], { windowsHide: true });
    await Promise.race([exited, delay(10000).then(() => { throw new Error('El portable no terminó al cerrar la ventana.'); })]);
    assert.equal(await isPortOpen(port), false);
    const report = { date: new Date().toISOString(), result: 'passed', executable,
      size: (await fs.stat(executable)).size, sha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex'),
      checks: ['Únicamente el EXE en una ruta con espacios y acentos', 'Arranque sin argumentos y sin Node en PATH',
        'HTTP sirve la web empaquetada', 'Título de ventana correcto', 'Cierre de ventana libera puerto y proceso'] };
    const artifacts = path.resolve(process.argv[4] ?? path.resolve(__dirname, '../artifacts/package'));
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'portable-results.json'), JSON.stringify(report, null, 2));
    console.log('PASS portable autónomo: sin Node en PATH, web incluida y cierre limpio');
  } finally {
    if (child?.pid && child.exitCode === null) await killTree(child.pid);
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('webbox portable España ')) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
