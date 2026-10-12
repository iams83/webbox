'use strict';
require('../node/server');
console.log('\x1b[32;1mServidor de ejemplo · España\x1b[0m');
console.error('\x1b[33mAviso de prueba en stderr; el servidor sigue activo.\x1b[0m');
let count = 0;
setInterval(() => console.log('Actividad ' + ++count + ' · ' + new Date().toLocaleTimeString('es-ES')), 2000);
