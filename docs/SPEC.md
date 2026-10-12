# Especificación objetivo

Requisitos de la versión completa de WebBox, un launcher Windows en Electron/JavaScript que ejecuta servidores web locales y muestra su interfaz nativa. **Esta lista no describe funciones ya disponibles:** consulta el [README](../README.md) para el contrato actual y [MILESTONES.md](MILESTONES.md) para el avance.

## CLI y manifiesto

Uso distribuido: `launcher.exe ruta\al\manifiesto.app.json [--debug] [--trust]`. Los errores de uso o JSON deben mostrarse en una ventana comprensible, sin consola.

Validar con esquema y errores por campo. Mantener los campos actuales y añadir:

| Opción | Requisito pendiente |
| --- | --- |
| `port.mode` | `env`, `arg` o `placeholder`; `name` identifica variable o argumento. Mantener `{PORT}` en args/env. |
| `port.fixed` / `range` | Puerto fijo o rango inclusivo; documentar el formato, precedencia y validación en el esquema. |
| `ready.type` | `port`, `http` o `stdout`; HTTP usa `path` (por defecto `/`), stdout exige `pattern` como expresión regular JavaScript. |
| `detached` | `false` por defecto; supervisión por puerto cuando el comando se desprende. |
| `window.rememberBounds` | `false` por defecto; persistir tamaño y posición. |
| `singleInstance` | `false` por defecto; bloquear/enfocar por aplicación. |
| `logOnStart` | `false` por defecto; mostrar el log al iniciar. |

El comando debe ser un ejecutable más argumentos separados. Las rutas de cwd/icon/command con separadores se resuelven desde el manifiesto; las rutas dentro de args las interpreta el runtime desde cwd.

## Arranque y runtimes

- Reservar/liberar un puerto en 127.0.0.1 y reintentar hasta tres veces ante conflictos.
- Ejecutar con spawn, ventana oculta y captura UTF-8 de stdout/stderr. Resolver npm/npx y archivos .cmd en Windows sin aceptar líneas de shell arbitrarias.
- Para Python, establecer PYTHONUNBUFFERED=1 y PYTHONIOENCODING=utf-8. Detectar el alias de la Microsoft Store (WindowsApps o comprobación --version fallida); probar py si python no sirve e indicar qué runtime se utilizó. Si ambos fallan, explicar cómo instalarlo.
- Mostrar carga hasta ready; timeout, runtime ausente y salida prematura muestran causa, últimas salidas y acciones Reintentar / Ver log / Salir. Una caída posterior permite reiniciar el servidor.
- Con detached=false, la salida 0 antes de ready es un fallo que explica el posible desprendimiento.
- Con detached=true, aceptar salida 0 y comprobar ready por puerto o HTTP; vigilar el puerto en lugar del proceso inicial. Al cerrar, localizar el PID que escucha y terminar su árbol. No garantizar el cierre si cambia de puerto.

## Ventana, navegación y perfiles

- BrowserWindow sin menú ni barra de direcciones, con icono/título propios y web en WebContentsView.
- Servidor HTTP que escucha solo en 127.0.0.1. Admitir navegación en http://localhost:PUERTO y http://127.0.0.1:PUERTO; permitir sus WebSockets locales. HTTPS del servidor queda fuera de alcance.
- Cancelar navegación externa, redirecciones a otros puertos y ventanas nuevas. Abrir destinos principales fuera de WebBox solo con http/https/mailto; ignorar otros esquemas y bloquear subframes externos.
- Gestionar descargas con diálogo Guardar, subida de archivos y alert/confirm nativos.
- Separar sesión, almacenamiento y bloqueos por name. Con singleInstance=true, establecer identidad/rutas antes de requestSingleInstanceLock y enfocar la ventana existente. additionalData transporta datos; no es clave de bloqueo. Con false, permitir varias instancias.
- Mantener contextIsolation=true, nodeIntegration=false y sandbox=true. La web no recibe preload; la interfaz local solo expone su API mínima. Gestionar permisos de sesión explícitamente y denegar los no soportados.
- Solicitar confianza antes de la primera ejecución, mostrando command/args/cwd. Recordar aprobación por hash del fichero y volver a solicitarla si cambia. --trust omite el aviso y debe documentar que permite ejecutar código sin confirmación.

## Log, zoom y recuperación

- F12 alterna entre dos WebContentsView (web/log) sin recargar la web. Interceptar before-input-event en ambas y enfocar la vista activa, incluso si la web captura teclas.
- Sin controles añadidos sobre la web. El log muestra estado arrancando/activo/caído, “F12 para volver”, limpiar, copiar y pausar autoscroll.
- Distinguir stdout/stderr por color; conservar 10000 líneas, interpretar ANSI básico y escribir archivos rotados en el perfil.
- Abrir DevTools solo con Ctrl+Shift+F12 y --debug.
- Permitir Ctrl+rueda y Ctrl+/-/0; persistir zoom por aplicación. Verificar las pantallas locales al 125 %, 150 % y 200 %.
- Conservar la recuperación del renderer y añadir reintentos de servidor desde la interfaz.

## Cierre y distribución

Intentar apagado suave con timeout corto y después forzar el árbol (taskkill /T /F /PID), esperando su terminación tanto al cerrar ventana como al salir de Electron. Evitar servidores huérfanos al matar/crashear el launcher: evaluar un Job Object o watchdog independiente, justificar la solución y probar descendientes y detached. Se prefiere evitar dependencias nativas si el watchdog resulta suficientemente fiable.

Empaquetar con electron-builder: NSIS, portable, metadatos e icono. Implementar/verificar la asociación de extensión compuesta .app.json solo en NSIS; portable usa ruta por CLI o arrastrar el manifiesto sobre el ejecutable. Documentar la firma Authenticode, credenciales fuera del repositorio y su relación con SmartScreen sin prometer la eliminación de todos los avisos.

## Aceptación

Ejecutar pruebas y registrar entorno/resultados para:

- Cierre del servidor y todos sus descendientes al cerrar la ventana y al matar el launcher.
- Navegación externa bloqueada dentro de WebBox, incluidas redirecciones a otro puerto.
- F12 con foco en ambas vistas y web que captura teclas.
- Diagnósticos de fallos de arranque, incluido Python Store, y recuperación del servidor.
- Detached: arranque, supervisión y cierre del árbol por puerto.
- Manifiestos distintos en procesos simultáneos sin interferencia; rutas con espacios y acentos.
- Zoom persistente y pantallas locales al 125/150/200 %.
- Instalación, portable, asociación NSIS y firma según la configuración distribuida.

Crear ejemplos Node, Python, arranque lento, fallo, descendientes mediante npm y detached. Avanzar por los seis hitos de MILESTONES y confirmar cada uno antes del siguiente. Las decisiones ambiguas deben resolverse con la opción más simple y quedar documentadas.
