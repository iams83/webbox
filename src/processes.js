'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');

const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const snapshotScript = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new();
  @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {
    @{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;born=$_.CreationDate.ToUniversalTime().ToString('o')}
  }) | ConvertTo-Json -Compress`;

function processSnapshot(signal, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    execFile(path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', snapshotScript],
      { windowsHide: true, signal, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        if (signal?.aborted) return reject(signal.reason);
        if (error) return reject(new Error('No se pudo comprobar el árbol de procesos: ' + error.message));
        try {
          const parsed = JSON.parse(stdout.replace(/^\uFEFF/, ''));
          const rows = (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({ ...row, born: Date.parse(row.born) }));
          if (rows.some(row => !Number.isInteger(row.pid) || !Number.isInteger(row.parent) || !Number.isFinite(row.born))) throw new Error('datos inválidos');
          resolve(rows);
        } catch (cause) { reject(new Error('No se pudo interpretar el árbol de procesos: ' + cause.message)); }
      });
  });
}

// Las fechas evitan atribuir a un padre muerto un proceso creado tras su salida.
function relatedProcesses(rows, root, known = new Map(), observedAt = Date.now()) {
  const related = new Map([[root.pid, { ...root, until: root.until ?? Infinity }]]);
  for (const [pid, record] of known) {
    const live = rows.find(row => row.pid === pid);
    if (live && live.born === record.born) related.set(pid, { ...record, until: Infinity });
    else if (!live) related.set(pid, { ...record, until: record.seenAt });
  }
  let added;
  do {
    added = false;
    for (const row of rows) {
      if (related.has(row.pid)) continue;
      const parent = related.get(row.parent);
      if (parent && row.born >= parent.born && row.born <= parent.until) {
        related.set(row.pid, { ...row, until: Infinity, seenAt: observedAt });
        added = true;
      }
    }
  } while (added);
  return rows.filter(row => {
    const expected = related.get(row.pid);
    return expected && (row.pid === root.pid ? row.born >= root.born && row.born <= (root.until ?? Infinity) : row.born === expected.born);
  });
}

function killTree(pid, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    execFile(path.join(system32, 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: timeoutMs }, error => {
        // Un proceso puede salir entre la instantánea y taskkill. La confirmación
        // posterior decide si el cierre se completó, no el texto traducido.
        if (error?.killed || error?.code === 'ENOENT') reject(new Error('No se pudo terminar el árbol: ' + error.message));
        else resolve();
      });
  });
}

module.exports = { processSnapshot, relatedProcesses, killTree };
