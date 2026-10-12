'use strict';

const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  detached: true, windowsHide: true, stdio: 'ignore'
});
process.send([process.pid, child.pid]);
setInterval(() => {}, 1000);
