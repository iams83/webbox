# Guía de desarrollo

JavaScript CommonJS, APIs directas de Electron/Node y HTML/CSS, sin framework ni compilación. `package.json` fija Electron; `package-lock.json` permite instalar con `npm.cmd ci`. Los comandos y el contrato del manifiesto están en el [README](../README.md).

## Mapa del código

| Archivo | Responsabilidad |
| --- | --- |
| [src/main.js](../src/main.js) | Entrada Electron, requisito Windows, argumentos y salida coordinada con before-quit. |
| [src/manifest.js](../src/manifest.js) | Parseo de CLI/JSON, validación del soporte actual, valores predeterminados y resolución de rutas. |
| [src/server.js](../src/server.js) | Puerto, spawn, logs, readiness TCP, detección de salida y cierre del proceso directo. |
| [src/launcher.js](../src/launcher.js) | Ventana, sesiones, WebContentsView, estados, navegación, recuperación e IPC local. |
| [src/load-page.js](../src/load-page.js) | Carga de URL con timeout y cancelación mediante AbortSignal. |
| [src/security.js](../src/security.js) | Identidad por nombre, validación de URL, denegación de permisos y filtro de documentos por sesión/vista. |
| [src/ui](../src/ui) | Pantallas locales de carga/error y preload mínimo para solicitar una recarga. |
| [examples/node](../examples/node) | Servidor de referencia, manifiesto y web de demostración. |

## Ciclo de vida

1. `main.js` espera a Electron y crea un `Launcher`.
2. `start(argv)` valida el manifiesto, prepara el perfil y muestra el estado `starting` en el contenido local de BrowserWindow.
3. `LocalServer.start()` reserva/libera el puerto, ejecuta el comando y comprueba TCP cada 100 ms.
4. Se crea la WebContentsView con la sesión persistente de la aplicación. `loadPage()` carga la URL con su propio plazo.
5. Solo tras la carga se muestra y enfoca la vista, con estado `running`. Los fallos llevan a `error`, distinguiendo arranque, servidor y página.
6. `close()` cancela la carga y devuelve siempre la misma promesa de cierre. `dispose()` espera al servidor, retira handlers/políticas y destruye las vistas; estado `closed`.

Un error de página conserva el servidor y habilita recarga. Una vista sin respuesta se sustituye forzando la salida de su renderer antes de cargar de nuevo. La salida del servidor cancela cualquier carga pendiente. Un fallo inicial sin error de página intenta detener el servidor.

## Invariantes al modificar el código

- Mantener el contenido web sin preload, Node.js ni DevTools, con sandbox y contextIsolation. El preload de estado solo expone recarga; su handler verifica el emisor y el estado del servidor.
- Validar URL por protocolo, host, puerto y ausencia de credenciales. Cubrir enlaces, redirecciones, ventanas y carga inicial de iframes; `will-frame-navigate` por sí solo no cubre todos los casos.
- Electron permite un handler webRequest por evento y sesión: `security.js` comparte el filtro y registra el puerto por webContentsId. Conservar esa coordinación y su limpieza si varias vistas comparten nombre.
- No usar `name` como ruta literal. La interfaz local tiene sesión temporal separada; el perfil web se deriva de su hash.
- Observar rechazos de cargas canceladas y comprobar `closing` antes de mostrar resultados. `statusRevision` evita que una pantalla anterior recupere el foco.
- El timeout TCP y el de página son independientes. Las promesas de cierre son idempotentes; no sustituirlas por esperas indefinidas.
- El log actual conserva 200 fragmentos y muestra hasta 12000 caracteres. No equivale al buffer por líneas ni a la rotación previstos.
- La supervisión y el cierre de árboles del harness pertenecen a las pruebas; no aportan esas garantías al servidor de producción.

## Validación de cambios

| Suite | Qué verifica |
| --- | --- |
| `npm.cmd test` | Manifiestos, políticas de seguridad, carga/cancelación y servidores Node reales, sin Electron. |
| `test/electron-smoke.js` | Launcher con Electron real: DOM, aislamiento, errores, recuperación, navegación, permisos y sesiones. |
| `test/main-smoke.js` | Carga la entrada de producción `src/main.js` y comprueba el cierre del proceso directo por before-quit. |
| `scripts/run-smoke.js` | Ejecuta ambas secuencias Electron, supervisa cada una durante 60 s y exige informes actuales/completos. |

Para cambios de manifiesto/servidor/seguridad/carga, ejecuta la suite Node. Para cambios de ventana, IPC, navegación, recuperación o salida, ejecuta también `npm.cmd run test:smoke`. Si cambia la interfaz, usa `--require-captures` e inspecciona las imágenes.

Las comprobaciones de Launcher se enumeran en [test/smoke-checks.json](../test/smoke-checks.json); actualiza esa lista y el harness juntos. El runner valida identificador, fecha, nombres y resultado para impedir falsos éxitos por informes antiguos.

Los informes son `artifacts/smoke/results.json` y `main-results.json`; las capturas, `demo.png`, `error.png` y `renderer-error.png`. Cada ejecución registra si se capturaron: no atribuyas una imagen antigua al último resultado. El modo normal tolera fallos del compositor tras reintentos; `--require-captures` los convierte en fallo. Los perfiles de prueba están separados del perfil de usuario.

Los límites de las pruebas y su último resultado medido están en [MILESTONES.md](MILESTONES.md). Al cambiar comportamiento, actualiza el contrato actual en README; conserva los requisitos futuros en SPEC.
