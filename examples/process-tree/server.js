'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Un ejecutable directo también puede crear ramas y nietos detached.
const branch = spawn(process.execPath, [path.join(__dirname, 'worker.js')], {
  detached: true, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc']
});
branch.once('message', pids => {
  const info = { pids: [process.pid, ...pids], port: Number(process.env.PORT) };
  http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/pids' ? 'application/json' : 'text/html; charset=utf-8');
    response.end(request.url === '/pids' ? JSON.stringify(info) : fs.readFileSync(path.join(__dirname, '../node/index.html')));
  }).listen(info.port, '127.0.0.1', () => {
    console.log('Árbol listo: ' + JSON.stringify(info));
    if (process.env.WEBBOX_TREE_INFO) fs.writeFileSync(process.env.WEBBOX_TREE_INFO, JSON.stringify(info));
  });
});
