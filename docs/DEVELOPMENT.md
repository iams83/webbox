# Guía de desarrollo

Lee primero el [contrato actual](../README.md), luego esta guía. [MILESTONES.md](MILESTONES.md) registra avance/evidencia; [SPEC.md](SPEC.md), trabajo pendiente. JavaScript CommonJS, sin framework ni compilación; dependencias y versiones fijadas en package.json/package-lock.json.

## Mapa del código

| Entrada | Responsabilidad |
| --- | --- |
| [main.js](../src/main.js) | Inicio Windows, CLI y cierre coordinado con `before-quit`. |
| [manifest.js](../src/manifest.js), [esquema](../src/manifest.schema.json) | CLI/JSON, estructura Ajv, contratos entre campos, defaults y rutas. |
| [launcher.js](../src/launcher.js) | Ventana, vistas/sesiones, estados, navegación, recuperación, atajos e IPC. |
| [server.js](../src/server.js) | Spawn, readiness/reintentos, supervisión detached y cierre. |
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
2. `LocalServer.start` reserva/libera puerto, resuelve runtime, lanza y verifica readiness/propietario. Un AbortController y plazo abarcan todos los intentos; solo los conflictos permiten reintentar.
3. Tras readiness crea webView con sesión persistente, instala políticas y carga `startUrl` con plazo independiente. Estado `running` solo tras cargar.
4. `state` (`idle/starting/running/error/closed`) y `activeView` (`content/log`) son independientes: F12 conserva web/servidor y el log puede seguir visible durante carga/error.
5. Error de página permite recarga; si el renderer no responde, fuerza su salida antes de cargar. Error de servidor permite reinicio: espera cierre, sustituye webView/LocalServer y conserva ventana, sesión, logView, buffer y archivo.
6. `close` cancela carga/descargas e inicia una única promesa; `LocalServer.stop` cancela/espera arranque y termina procesos. `dispose` espera logs, retira handlers/políticas y destruye vistas/ventana. `before-quit` espera ese cierre.

## Invariantes

- Web sin preload/Node, sandbox/contextIsolation; DevTools solo con `--debug`. Estado y log tienen sesiones temporales y APIs distintas. Validar emisor IPC; log además exige frame principal. Acciones de recuperación respetan estado/`closing`.
- Filtrar documentos por protocolo/host/puerto/credenciales, incluidas redirecciones, ventanas e iframes iniciales. Electron admite un handler webRequest por evento/sesión: mantener el registro compartido y su limpieza. La excepción interna `devtools://devtools/` solo existe mientras haya una vista debug; la web registrada mantiene el filtro HTTP.
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

Suite Node para manifiesto/servidor/seguridad/carga; añadir Electron para ventana/IPC/navegación/recuperación/salida. Requieren Windows, Node/npm y Python/py; restricciones de CIM, conexiones locales o escritura pueden requerir permisos del entorno. Detener servidores antes de borrar su cwd en Windows.

No ejecutar smoke en paralelo: comparte `artifacts/smoke/`. Allí genera perfiles separados del usuario, `results.json`, `main-results.json` y capturas `demo.png`, `error.png`, `renderer-error.png`, `log.png`; todo excluido de Git. Comprobar fecha/estado de captura para no usar una imagen antigua. Modo normal tolera fallos del compositor; `--require-captures` los hace fallar. [Última evidencia y límites](MILESTONES.md#validación).

Al cambiar comportamiento, actualizar README; al completar requisitos, retirarlos de SPEC y actualizar MILESTONES. Versiones en package.json, contrato estructural en el esquema, nombres de checks en smoke-checks: evitar duplicarlos en esta guía.
