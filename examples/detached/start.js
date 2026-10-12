'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const child = spawn(process.execPath, [path.join(__dirname, '../node/server.js')], {
  env: process.env, detached: true, windowsHide: true, stdio: 'ignore'
});
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.unref();
