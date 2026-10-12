'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1) throw new Error('PORT debe contener un puerto válido.');
const server = http.createServer((request, response) => {
  if (request.url === '/download') {
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': "attachment; filename*=UTF-8''informe%20Espa%C3%B1a.txt"
    });
    response.end('WebBox · España\nArchivo de demostración.\n');
    return;
  }
  if (request.url === '/upload' && request.method === 'POST') {
    let bytes = 0;
    request.on('data', chunk => { bytes += chunk.length; });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ bytes }));
    });
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
});
server.on('error', error => { console.error(error); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Servidor listo en http://127.0.0.1:${port} · España`));
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
