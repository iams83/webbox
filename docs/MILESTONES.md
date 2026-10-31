# Estado y validación

[README](../README.md): contrato disponible. [DEVELOPMENT](DEVELOPMENT.md): código/pruebas. [SPEC](SPEC.md): requisitos pendientes.

| Hito | Alcance | Estado |
| --- | --- | --- |
| 1 | Servidor Node oculto, ventana y WebContentsView | Completo. |
| 2 | Esquema, puertos/reintentos, HTTP/stdout, runtimes y detached | Completo. |
| 3 | Navegación, descargas/diálogos y cierre de árboles | Completo. |
| 4 | F12, xterm/ANSI, acciones y logs rotados | Completo. |
| 5 | Muerte brusca, apagado suave, confianza, instancia única, bounds/zoom/escalado | Pendiente; perfiles y recuperación ya disponibles. |
| 6 | electron-builder, NSIS, portable, icono, asociación y firma | Parcial: portable estático con HTML/carpeta y runtime incluidos; pendientes instalador y distribución general. |

**Siguiente desarrollo:** hito 5, primero protección ante muerte brusca y apagado suave. Criterios y decisiones por resolver en SPEC.

## Validación

Validación funcional del lanzador: **17 de octubre de 2026**. Incluye el modo estático.

| Comprobación | Resultado |
| --- | --- |
| `npm.cmd test` | 88 aprobadas, 0 fallos; pruebas de empaquetado repetidas tras el ajuste final: 4 aprobadas. |
| `npm.cmd run test:smoke` | 32 checks de Launcher y 1 de entrada de producción aprobados; incluye HTML/CSS/módulos estáticos y cierre del puerto. |
| Sintaxis JavaScript | 35 archivos `.js` válidos en src/scripts/test. |

Entorno: Windows 10.0.26300 x64, Node host 24.19.0, Electron 44.7.0 (Node 24.21.0), Python/py 3.12.0, escala 100 %. Informes de `artifacts/smoke/` a las 16:14 UTC, excluidos de Git; regeneración y supervisión en DEVELOPMENT. Las pruebas requieren ejecución fuera del sandbox para conexiones loopback, enlaces de carpetas y CIM. La validación del empaquetador usa la demo estática propia; sus informes y captura se guardan en `artifacts/package/`.

### Empaquetador genérico: 31 de octubre de 2026

- `node --test test/package-static.test.js`: 5 aprobadas fuera del sandbox; incluye copia exclusiva del HTML y destino predeterminado independiente del nombre.
- `npm.cmd run package:static -- examples/static/public --name "WebBox Demo"`: portable generado en `dist/webbox-demo-0.1.0-win-x64.exe`.
- `npm.cmd run test:packaged`: aprobado; HTML, CSS y módulo desde el ASAR, Web Crypto y aislamiento. Captura obtenida en `artifacts/package/static-demo.png`.
- `npm.cmd run test:portable`: falla al detectar el servidor integrado del EXE; la ejecución del portable queda sin validar.
- `npm.cmd test`: 64 aprobadas y 25 fallidas, también fuera del sandbox. Los fallos afectan al arranque, readiness y supervisión de servidores en `hito2`, `hito3` y `server`; requieren una revisión separada. No se modificó el código de esas áreas.

### Argumentos y pantalla de arranque: 31 de octubre de 2026

- `node --test test/manifest.test.js test/arguments.test.js`: 23 aprobadas; CLI con/sin manifiesto integrado, argumentos literales, orden/puerto, reintentos y procesos Node/Python reales.
- `npm.cmd run test:startup`: 4 recorridos aprobados; cargador sin diagnóstico, temas claro/oscuro con cambio en vivo, transición a la web, recarga tras error y cierre durante arranque. Capturas inspeccionadas e informe en `artifacts/startup/`.
- Portable de la demo reconstruido; `npm.cmd run test:exe-args`: aprobados los dos recorridos EXE → Node/Python con espacios, comillas y argumentos vacíos. Se usa un manifiesto externo y programas que escriben los argumentos recibidos y terminan; esta prueba confirma la entrega de argumentos, no readiness HTTP.
- `npm.cmd run test:packaged`: aprobado con el ASAR reconstruido; recursos estáticos, Web Crypto y aislamiento.
- Suite completa `npm.cmd test`: 72 aprobadas y 22 fallidas de 94. Persisten fallos ya observados en readiness/propiedad/cierre de servidores; detalle de esta ejecución en `.tmp-startup-tests.log` (ignorado). Las nuevas pruebas de argumentos pasan dentro de esa ejecución.

### Prefijos de navegación y enlaces externos: 31 de octubre de 2026

- 41 pruebas aprobadas en `security`, `manifest`, `arguments`, `static-server` y `package-static`; cubren prefijos HTTP/HTTPS, puerto dinámico, límites de origen/ruta y aislamiento entre vistas de una sesión compartida.
- `npm.cmd run test:navigation`: 6 recorridos aprobados con enlaces reales. Verifica ambos hosts locales, enlaces externos, `_blank` local/externo, prefijos adicionales, redirecciones, iframes bloqueados y error al abrir el navegador.
- Portable de la demo reconstruido; los mismos 6 recorridos pasan con `npm.cmd run test:navigation -- dist/win-unpacked/resources/app.asar`. Informe final en `artifacts/navigation/results.json`. Las llamadas al navegador se recogen con un callback; no se abren pestañas reales.
- `npm.cmd run test:startup`: 4 recorridos aprobados tras el cambio. No se repitió la suite completa de supervisión de procesos; sus últimos resultados y fallos constan arriba.

Cobertura Node: esquema/defaults/rutas, runtimes, TCP/HTTP/stdout, reserva/rango/fijo/carreras, PID ajeno/wildcard, reintentos/plazos/cancelación, descendientes/detached, logs/rotación y fallos de disco. Electron añade web real, recuperación, aislamiento/permisos, navegación/iframes, descargas/subida/diálogos, F12/foco/ANSI/acciones/DevTools, reinicio y cierre de hijo/nieto desde ventana y `before-quit`. Casos concretos en los tests y [smoke-checks.json](../test/smoke-checks.json).

### Límites de la evidencia

- `unresponsive` se simula por evento; la recuperación comprueba un nuevo PID del renderer. Destinos externos se recogen con callback, sin abrir navegador/correo del sistema.
- Perfiles distintos se prueban con dos Launcher en un proceso Electron; falta simultaneidad entre procesos independientes. Se verifican scripts reales Python/npm/detached, sin ejecución manual de cada manifiesto de ejemplo.
- Descargas: opciones de Guardar y bytes HTTP/Blob, con destino fijado por harness. Subida: selector interceptado con CDP y archivo real. Alert/confirm: JavaScript real, `showMessageBox` sustituido para comprobar ventana/opciones/respuestas. No se valida visualmente el diálogo ni selección/sobrescritura manual.
- Cierre: árboles y wrappers de los casos probados, no muerte brusca ni apagado suave. Las instantáneas PID/fecha no garantizan descubrir ramas no observadas; límites operativos en README.
- Solo escala 100 %; pendientes 125/150/200 %, zoom persistente y distribución general. El portable estático se ha probado en este equipo con solo el EXE y sin Node en PATH; falta validación en otro Windows limpio. No se ha probado instalador ni firma.

La aceptación de la distribución general del lanzador depende de completar y verificar los hitos 5–6; la variante portable estática ya se puede generar con las limitaciones indicadas.
