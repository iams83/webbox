# Guía de desarrollo

Lee primero el [contrato actual](../README.md), luego esta guía. [MILESTONES.md](MILESTONES.md) registra avance/evidencia; [SPEC.md](SPEC.md), trabajo pendiente. JavaScript CommonJS, sin framework ni compilación; dependencias y versiones fijadas en package.json/package-lock.json.

## Mapa del código

| Entrada | Responsabilidad |
| --- | --- |
| [main.js](../src/main.js) | Inicio Windows, CLI y cierre coordinado con `before-quit`. |
| [manifest.js](../src/manifest.js), [esquema](../src/manifest.schema.json) | CLI/JSON, estructura Ajv, contratos entre campos, defaults y rutas. |
| [launcher.js](../src/launcher.js) | Ventana, vistas/sesiones, estados, navegación, recuperación, atajos e IPC. |
| [server.js](../src/server.js) | Spawn, readiness/reintentos, supervisión detached y cierre. |
| [static-server.js](../src/static-server.js) | HTTP estático dentro del proceso, MIME, rutas públicas y cierre. Lee también recursos de ASAR. |
| [package-static.js](../scripts/package-static.js) | Prepara HTML/carpeta pública y manifiesto incluido; electron-builder genera un `.exe` portable x64. |
| [ports.js](../src/ports.js), [processes.js](../src/processes.js) | Selección/propietario de puerto, CIM PID/fecha y terminación de árboles. |
| [runtimes.js](../src/runtimes.js), [stdout-ready.js](../src/stdout-ready.js) | Python/npm/batch; regexp stdout en worker cancelable. |
| [load-page.js](../src/load-page.js) | Carga con timeout/AbortSignal. |
| [security.js](../src/security.js) | Identidad NFC/hash, URL, permisos y filtro de documentos por sesión/vista. |
| [downloads.js](../src/downloads.js) | Guardar, nombres, cancelación y coordinación de vistas por sesión. |
| [log-buffer.js](../src/log-buffer.js), [log-writer.js](../src/log-writer.js) | Líneas/ANSI/CR, límites, escritura agrupada y rotación. |
| [ui/](../src/ui) | Estado/error y visor xterm, con preloads mínimos separados. |
| [examples/](../examples/README.md) | Servidores/manifiestos de referencia. |

## Ciclo de vida

1. `main` espera a Electron; `Launcher.start` valida CLI/manifiesto, crea perfil, LogWriter, ventana de estado y vista de log.
2. Con `command`, `LocalServer.start` reserva/libera puerto, resuelve runtime, añade los argumentos CLI literalmente a los del manifiesto/puerto, lanza y verifica readiness/propietario. Un AbortController y plazo abarcan todos los intentos; solo los conflictos permiten reintentar. Con `static.root`, `StaticServer` abre directamente un listener HTTP loopback sin proceso externo. Un paquete usa `embedded/app.app.json` dentro de `app.asar`; `--manifest` permite elegir otro manifiesto y `--` delimita los argumentos de la aplicación.
3. Tras readiness crea webView con sesión persistente, instala políticas y carga `startUrl` con plazo independiente. Estado `running` solo tras cargar.
4. `state` (`idle/starting/running/error/closed`) y `activeView` (`content/log`) son independientes: F12 conserva web/servidor y el log puede seguir visible durante carga/error.
5. Error de página permite recarga; si el renderer no responde, fuerza su salida antes de cargar. Error de servidor permite reinicio: espera cierre, sustituye webView/LocalServer y conserva ventana, sesión, logView, buffer y archivo.
6. `close` cancela carga/descargas e inicia una única promesa; `LocalServer.stop` cancela/espera arranque y termina procesos. `dispose` espera logs, retira handlers/políticas y destruye vistas/ventana. `before-quit` espera ese cierre.

La ventana nace oculta con un fondo calculado mediante `nativeTheme`; se muestra en `ready-to-show`. Durante arranque/recarga carga `ui/loading.html` (solo un indicador accesible); `ui/status.html` queda reservado a errores. Ambas comparten `status.css` con `prefers-color-scheme`, y el fondo nativo se sincroniza con los cambios de tema. La web conserva sus estilos propios.

## Invariantes

- Web sin preload/Node, sandbox/contextIsolation; DevTools solo con `--debug`. Estado y log tienen sesiones temporales y APIs distintas. Validar emisor IPC; log además exige frame principal. Acciones de recuperación respetan estado/`closing`.
- Filtrar documentos por los orígenes locales y los prefijos HTTP/HTTPS de cada manifiesto, comparando origen y límite de ruta, sin credenciales. Aplicar la misma política a redirecciones e iframes iniciales. Los enlaces principales fuera de ella se envían a `shell.openExternal`; las ventanas nuevas, incluido `_blank`, siempre se envían fuera. Electron admite un handler webRequest por evento/sesión: mantener el registro por vista y su limpieza para no compartir prefijos entre aplicaciones. La excepción interna `devtools://devtools/` solo existe mientras haya una vista debug.
- No usar `name` como ruta: `appIdentity` genera el hash NFC. Vistas con nombre igual comparten sesión; handlers de descargas no duplican ni cancelan operaciones de otra vista.
- Observar rechazos de cargas canceladas y eventos de vistas antiguas. `statusRevision` evita recuperar un foco obsoleto. Cierre/terminación son idempotentes y acotados; no lanzar procesos después de cancelar.
- Un puerto abierto no acredita propiedad. Mantener CIM/fechas para descendientes y PID reutilizados; no adoptar/matar un listener ajeno. No convertir instantáneas en garantías de cierre de ramas no observadas.
- Readiness stdout recibe texto original antes del filtro ANSI. LogBuffer y writer sobreviven a reintentos/reinicios; límites en README. UI agrupa cambios cada 100 ms, consolida snapshots hasta ack y espera parser xterm entre bloques de 64 KiB. No reenviar controles OSC/cursor ni habilitar stdin.

## Verificar cambios

```powershell
npm.cmd test
npm.cmd run test:smoke
# Cambios de interfaz: exigir e inspeccionar capturas
npm.cmd run test:smoke -- --require-captures
```

| Suite | Cobertura |
| --- | --- |
| `test/*.test.js` | Manifiesto, seguridad, carga, puertos/readiness/reintentos y servidores reales; hito2: runtimes/stdout/detached; hito3: árboles/cancelación; downloads/log: coordinación, límites y persistencia. |
| [electron-smoke.js](../test/electron-smoke.js) | Launcher real: DOM/aislamiento, recuperación, navegación, archivos, perfiles, F12/xterm, DevTools y reinicio. Lista exigida en [smoke-checks.json](../test/smoke-checks.json); actualizar ambos juntos. |
| [main-smoke.js](../test/main-smoke.js) | Entrada real y cierre de servidor/hijo/nieto detached por `before-quit`. |
| [run-smoke.js](../scripts/run-smoke.js) | Ejecuta ambas secuencias; supervisión 210 s por secuencia (Launcher: 180 s interior), informes actuales/completos con ID/fecha/checks. |
| [arguments.test.js](../test/arguments.test.js) | Puerto/orden/reintentos y recepción literal de argumentos en procesos Node y Python reales; junto con `manifest.test.js`, cubre la CLI y manifiestos integrados. |
| [startup-smoke.js](../test/startup-smoke.js) | `npm.cmd run test:startup`: cargador, transición a web estática, diagnóstico, cambio de tema en vivo y cierre durante arranque; capturas claras/oscuras en `artifacts/startup/`. |
| [navigation-smoke.js](../test/navigation-smoke.js) | `npm.cmd run test:navigation`: enlaces reales, ambos hosts locales, prefijos/rutas, `_blank`, redirecciones e iframes; recoge las aperturas externas sin abrir el navegador real. Admite la ruta del ASAR como primer argumento tras `--` para probar el código empaquetado. Informe en `artifacts/navigation/`. |
| [test-executable-arguments.js](../scripts/test-executable-arguments.js) | `npm.cmd run test:exe-args`: ejecuta el portable con `--manifest`, comprueba argumentos recibidos por Node/Python y cierra el diagnóstico de los programas de prueba que terminan inmediatamente. |
| [packaged-smoke.js](../test/packaged-smoke.js) | `npm.cmd run test:packaged`: ejecuta la demo estática del ASAR final, comprueba HTML/CSS/módulos/Web Crypto/aislamiento y trata de capturar la interfaz. |
| [test-portable.js](../scripts/test-portable.js) | `npm.cmd run test:portable`: copia el EXE a una carpeta temporal, elimina Node del PATH heredado, verifica HTTP/título de ventana y cierra con WM_CLOSE. |

Suite Node para manifiesto/servidor/seguridad/carga; añadir Electron para ventana/IPC/navegación/recuperación/salida. Requieren Windows, Node/npm y Python/py; restricciones de CIM, conexiones locales o escritura pueden requerir permisos del entorno. Detener servidores antes de borrar su cwd en Windows.

Para repetir la validación del paquete:

```powershell
npm.cmd run package:static -- examples/static/public --name "WebBox Demo"
npm.cmd run test:packaged
npm.cmd run test:portable
npm.cmd run test:startup
npm.cmd run test:navigation
npm.cmd run test:exe-args
```

`test:packaged`, `test:portable` y `test:exe-args` usan `dist/win-unpacked/resources/app.asar` o `dist/webbox-demo-<versión de WebBox>-win-x64.exe` por defecto; admiten una ruta alternativa como primer argumento tras `--`. La prueba del ASAR requiere la demo estática de WebBox. La del portable admite otras webs pasando como segundo argumento su título nativo exacto: `npm.cmd run test:portable -- C:\entregas\miweb.exe MiWeb`; un tercer argumento permite cambiar la carpeta de informes. Estas dos guardan evidencia en `artifacts/package/`. La prueba del ASAR usa un perfil aislado; la del portable usa el perfil normal de la aplicación empaquetada y solo abre/cierra su pantalla inicial. `test:startup` y `test:exe-args` guardan informes/capturas en `artifacts/startup/`; la prueba del EXE con argumentos usa perfiles con nombres aleatorios. No sustituye una prueba en otro equipo Windows limpio. Los scripts de construcción y las pruebas de interfaz de cada aplicación pertenecen a su propio proyecto.

No ejecutar smoke en paralelo: comparte `artifacts/smoke/`. Allí genera perfiles separados del usuario, `results.json`, `main-results.json` y capturas `demo.png`, `error.png`, `renderer-error.png`, `log.png`; todo excluido de Git. Comprobar fecha/estado de captura para no usar una imagen antigua. Modo normal tolera fallos del compositor; `--require-captures` los hace fallar. [Última evidencia y límites](MILESTONES.md#validación).

Al cambiar comportamiento, actualizar README; al completar requisitos, retirarlos de SPEC y actualizar MILESTONES. Versiones en package.json, contrato estructural en el esquema, nombres de checks en smoke-checks: evitar duplicarlos en esta guía.
