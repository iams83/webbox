'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT);
const delayMs = Number(process.env.WEBBOX_STARTUP_DELAY_MS ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe contener un puerto válido.');
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw new Error('WEBBOX_STARTUP_DELAY_MS debe estar entre 0 y 60000.');
const page = fs.readFileSync(path.join(__dirname, '../node/index.html'));
let ready = false;
let timer;
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(ready ? 204 : 503);
    response.end();
    return;
  }
  response.writeHead(ready ? 200 : 503, { 'content-type': 'text/html; charset=utf-8' });
  response.end(ready ? page : 'Preparando la aplicación…');
});
server.on('error', error => { console.error(error); clearTimeout(timer); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`Puerto abierto en 127.0.0.1:${port}; preparación de ${delayMs} ms.`);
  timer = setTimeout(() => { ready = true; console.log('Aplicación lista · España'); }, delayMs);
});
const stop = () => { clearTimeout(timer); server.close(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
