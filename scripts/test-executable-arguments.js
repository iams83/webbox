'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const { killTree } = require('../src/processes');

const exec = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

async function main() {
  const executable = path.resolve(process.argv[2] ?? path.join(__dirname, `../dist/webbox-demo-${require('../package.json').version}-win-x64.exe`));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox exe args España '));
  const appArgs = ['--modo', 'España con espacios', '', 'a"b', 'R&D', '{PORT}', '--debug'];
  const checks = [];
  try {
    for (const runtime of ['node', 'python']) {
      const title = 'WebBox-arguments-' + randomUUID();
      const output = path.join(directory, runtime + '-result.json');
      const script = path.join(directory, runtime === 'node' ? 'args.cjs' : 'args.py');
      await fs.writeFile(script, runtime === 'node'
        ? 'require("node:fs").writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));'
        : 'import sys,json\nwith open(sys.argv[1],"w",encoding="utf-8") as f: json.dump(sys.argv[2:],f,ensure_ascii=False)\n');
      const manifest = path.join(directory, runtime + '.app.json');
      await fs.writeFile(manifest, JSON.stringify({ name: title, command: runtime === 'node' ? process.execPath : 'python', args: [script, output], ready: { timeoutMs: 5000 } }));
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(executable, ['--manifest', manifest, '--', ...appArgs], { env, windowsHide: true, stdio: 'ignore' });
      const exited = once(child, 'exit');
      exited.catch(() => {});
      try {
        let received;
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          try { received = JSON.parse(await fs.readFile(output, 'utf8')); break; } catch {}
          if (child.exitCode !== null) throw new Error('El EXE terminó antes de entregar los argumentos a ' + runtime + '.');
          await delay(100);
        }
        assert.deepEqual(received, appArgs, 'Argumentos recibidos por ' + runtime + ' desde el EXE');
        // El programa de prueba sale tras escribir sus argumentos: cerrar su diagnóstico.
        await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command',
          `$p = @(Get-Process | Where-Object { $_.MainWindowTitle -eq '${title}' }); if ($p.Count -ne 1 -or -not $p[0].CloseMainWindow()) { exit 1 }`], { windowsHide: true });
        await Promise.race([exited, delay(10000).then(() => { throw new Error('El EXE no terminó al cerrar su ventana.'); })]);
        checks.push('EXE → ' + runtime + ': argumentos, espacios, comillas y valores vacíos');
      } finally {
        if (child.pid && child.exitCode === null) await killTree(child.pid);
      }
    }
    const artifacts = path.resolve(__dirname, '../artifacts/startup');
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'executable-arguments.json'), JSON.stringify({ date: new Date().toISOString(), executable, checks }, null, 2));
    for (const check of checks) console.log('PASS ' + check);
  } finally {
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('webbox exe args España ')) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
