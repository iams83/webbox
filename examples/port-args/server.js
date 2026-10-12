'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const port = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : args[0]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Falta un puerto válido.');
const page = fs.readFileSync(path.join(__dirname, '../node/index.html'));
http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
}).listen(port, '127.0.0.1', () => console.log('READY ' + port));
