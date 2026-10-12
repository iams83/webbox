'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseListeners } = require('../src/ports');

test('propietario del listener distingue puertos, conexiones y formatos locales de Windows', () => {
  const output = `
  Proto Dirección local Dirección remota Estado PID
  TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 123
  TCP 127.0.0.1:30000 0.0.0.0:0 ESCUCHANDO 456
  TCP 127.0.0.1:3000 127.0.0.1:50123 ESTABLISHED 789
  TCP 0.0.0.0:3000 0.0.0.0:0 ABHÖREN 321
  TCP [::]:3000 [::]:0 LISTENING 987
  UDP 127.0.0.1:3000 *:* 555
  TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING invalid
`;
  assert.deepEqual(parseListeners(output, 3000), [{ host: '127.0.0.1', pid: 123 }, { host: '0.0.0.0', pid: 321 }]);
  assert.deepEqual(parseListeners(output, 30000), [{ host: '127.0.0.1', pid: 456 }]);
  assert.deepEqual(parseListeners(output, 80), []);
});
