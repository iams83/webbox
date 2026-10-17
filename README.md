# WebBox

Lanzador de servidores web locales y webs estáticas para **Windows**, con Electron y JavaScript CommonJS. Lee un manifiesto, arranca el servidor sin consola y muestra su web en una ventana sin menú ni barra de direcciones. Las webs estáticas usan un servidor HTTP integrado y se pueden distribuir en un único `.exe` portable con la web y Electron incluidos.

**Estado:** hitos 1–4 completos; incluye runtimes, readiness, navegación, archivos, recuperación y visor xterm.js. Disponible empaquetado portable de webs estáticas. Siguen pendientes parte de la robustez (hito 5) y la distribución general/instalador (hito 6).

## Empezar

Requiere Windows, Node.js **>=22.12.0**, npm y el runtime del servidor instalado. La demo necesita `node` en PATH.

```powershell
npm.cmd ci
npm.cmd run demo
npm.cmd start -- examples/logging/app.app.json
# Manifiesto propio; --debug es opcional:
npm.cmd start -- "C:\Mis aplicaciones\España\aplicación.app.json" --debug
```

Manifiesto mínimo para un `server.js` situado junto al JSON:

```json
{
  "name": "mi-app",
  "command": "node",
  "args": ["server.js"]
}
```

El servidor debe escuchar **solo en 127.0.0.1** y usar el puerto asignado (por defecto, variable `PORT`). Solo se admite HTTP local. Cerrar la ventana termina el servidor y sus descendientes comprobados.

**Confianza:** WebBox ejecuta el comando sin pedir aprobación; usa manifiestos de confianza. `--trust` se acepta pero aún no cambia el comportamiento. `--debug` habilita DevTools con Ctrl+Shift+F12 en web/log. F12 alterna web/log sin recargar.

Para desarrollar: [guía del código y pruebas](docs/DEVELOPMENT.md) → [estado y validación](docs/MILESTONES.md). Los [requisitos pendientes](docs/SPEC.md) y [ejemplos](examples/README.md) completan el contexto.

## Webs estáticas y ejecutable autónomo

Un manifiesto estático no necesita `command` ni un runtime externo:

```json
{
  "name": "mi-web",
  "static": { "root": "./public" }
}
```

`static.root` se resuelve desde el manifiesto. Sirve `/index.html` y recursos de esa carpeta por HTTP solo en `127.0.0.1`; admite `startUrl`, `port.fixed`/`port.range` y `ready.timeoutMs`. Sin puerto explícito, el sistema asigna uno libre al abrir directamente el listener. No lanza procesos ni usa comprobaciones CIM. Conserva navegación, aislamiento, descargas, logs y cierre de WebBox. Prueba `npm.cmd run demo:static`.

Solo admite GET/HEAD, sin listado de directorios ni fallback de SPA. Resuelve índices de subcarpetas y MIME de módulos, CSS, imágenes y otros recursos. Rechaza rutas fuera de la raíz, archivos/carpetas ocultos, enlaces que salgan de ella, rutas Windows/ADS y hosts ajenos. El contenido de la carpeta pública debe ser distribuible. `command`, `args`, `env`, `cwd`, `detached`, `port.mode`/`name` y readiness de procesos no se admiten en modo estático.

Para generar **un único ejecutable Windows x64**, desde la raíz de WebBox:

```powershell
# Singladura: instala dependencias si faltan, regenera el HTML y crea el EXE.
npm.cmd run package:singladura
# Si Singladura no esta en la carpeta hermana o quieres otro destino:
npm.cmd run package:singladura -- -SingladuraPath C:\proyectos\singladura -OutputPath C:\entregas
# Para reinstalar dependencias con npm ci antes de construir:
npm.cmd run package:singladura -- -InstallDependencies
```

El script [build-singladura.ps1](scripts/build-singladura.ps1) localiza ambos proyectos desde su propia ruta; también se puede ejecutar directamente desde PowerShell. Necesita Node.js >=22.12.0 y npm en el equipo de construcción. Termina con un código de error si falla cualquier paso. Por defecto busca Singladura en `../singladura` y deja el EXE en `dist/` de WebBox.

Para empaquetar un HTML ya generado o cualquier otra web:

```powershell
npm.cmd ci
# HTML autónomo: copia exclusivamente ese archivo como index.html.
npm.cmd run package:static -- C:\dev\node\singladura\singladura.html --name Singladura
# Web con varios archivos: carpeta de salida que contiene index.html y sus recursos.
npm.cmd run package:static -- C:\mi-web\public --name MiWeb
# Destino opcional (fuera de la carpeta pública):
npm.cmd run package:static -- C:\mi-web\public --name MiWeb --output C:\entregas
```

El resultado para Singladura es `dist/singladura-0.1.0-win-x64.exe`. Copia **solo ese `.exe`** a otro equipo Windows x64 compatible con Electron. No necesita Node.js, Python, un servidor instalado ni Internet para arrancar; las dependencias externas de cada web siguen siendo responsabilidad de esa web. La construcción sí puede descargar herramientas de empaquetado la primera vez. El comando empaqueta el HTML existente: regenera antes Singladura con su propio `npm run build` cuando cambien sus fuentes.

El ejecutable incluye código y recursos en un ASAR dentro del portable; al iniciarse se extrae a una carpeta temporal de Windows. No requiere instalación ni administrador, pero sí permiso para escribir en temporales y en el perfil del usuario, donde conserva logs y almacenamiento del navegador. Las preferencias/datos guardados en ese perfil no viajan dentro del ejecutable. Singladura sigue abriendo y guardando sus documentos con sus propios controles; el empaquetado no incluye los documentos financieros del proyecto.

La variante de carpeta copia sus recursos de forma recursiva; rechaza carpetas ocultas, `node_modules` y enlaces simbólicos para detectar entradas que no sean una salida pública. Un único HTML debe ser autónomo; si usa archivos relativos, utiliza la variante de carpeta. El portable no lleva firma Authenticode y usa el icono de Electron. Para reconstruirlo tras actualizar la web, repite el mismo comando.

## Contrato del manifiesto

JSON UTF-8 con BOM opcional. [manifest.schema.json](src/manifest.schema.json) valida estructura, tipos y límites; [manifest.js](src/manifest.js) valida relaciones entre campos. Se rechazan campos desconocidos, NUL y opciones no implementadas; los objetos omitidos o parciales reciben defaults.

| Campo | Default y comportamiento |
| --- | --- |
| `name` | Obligatorio, texto no vacío; identidad del perfil persistente. |
| `command` | Obligatorio en modo servidor externo, excluyente con `static`; ejecutable por PATH o ruta; argumentos separados, nunca una línea como `npm start`. |
| `static.root` | Alternativa a `command`: carpeta pública servida por el HTTP integrado, relativa al manifiesto. Ver empaquetado estático arriba. |
| `args` / `env` | `[]` / `{}`; textos, con sustitución de `{PORT}`. `env` amplía el entorno heredado. |
| `cwd` | Carpeta del manifiesto. |
| `title` / `icon` | `name` / icono de Electron; `icon` puede indicar un archivo. El título nativo no cambia con el de la web. |
| `port.mode` / `port.name` | `env` / `PORT`. `env` impone esa variable; `arg` añade `name PUERTO` (default `--port`, sin duplicados); `placeholder` exige `{PORT}` en args/env y no admite `name`. |
| `port.fixed` / `port.range` | Opcionales y excluyentes: puerto 1–65535 o `[inicio, fin]` inclusivo. Rango elige el primero libre; sin ambos, puerto automático. |
| `ready.type` | `port`: TCP abierto. También `http`: GET 2xx; `stdout`: patrón y TCP abierto. Todos exigen listener IPv4 propio o descendiente comprobado. |
| `ready.path` | `/`, solo para HTTP; ruta local, sin redirecciones ni espera del cuerpo. Independiente de `startUrl`. |
| `ready.pattern` | Obligatorio solo para stdout; regexp JavaScript de 1–512 caracteres, sin delimitadores/flags. Worker sobre los últimos 65536 caracteres UTF-16 de stdout; conserva fragmentos, descarta exceso y no usa stderr. |
| `ready.timeoutMs` | `30000`, entero 1–120000 ms para selección/runtime/readiness/reintentos. Cargar la página tiene otro plazo de esa duración. La limpieza puede añadir hasta 6 s de árbol y 6 s de proceso/pipes. |
| `startUrl` | `/`; ruta que empieza por `/`, sin `//` inicial, barras inversas ni controles. Mismas restricciones para `ready.path`. |
| `detached` | `false`; `true` acepta salida 0 del comando inicial y readiness port/http, vigila listener cada 500 ms. No admite stdout. |
| `logOnStart` | `false`; `true` abre el visor desde el arranque. |
| `window.width` / `height` | `1100` / `760` píxeles lógicos. |
| `window.minWidth` / `minHeight` | `480` / `320`; los cuatro tamaños admiten enteros 200–16384. |
| `singleInstance` / `window.rememberBounds` | Omitidos o `false`; `true` todavía se rechaza. |

`cwd`, `icon` y `command` con separadores se resuelven desde la carpeta del manifiesto; las rutas en args, desde `cwd` según el runtime. Los argumentos son literales salvo `{PORT}`. La ejecución usa `spawn`, `shell: false`, `windowsHide: true`. Arg/placeholder eliminan `PORT` heredado salvo declaración expresa en `env`.

## Runtimes

| Comando | Resolución |
| --- | --- |
| Node u otro ejecutable | Ejecución directa; runtime instalado por el usuario. |
| Python/python3/py | Preflight `--version`, descarta WindowsApps y prueba `py` si Python falla. Impone `PYTHONUNBUFFERED=1`, `PYTHONIOENCODING=utf-8`; registra el runtime o explica su ausencia. |
| npm/npx, también .cmd | CLI de la instalación estándar de Node ejecutado con `node.exe`, sin shell. Ejemplo: `"command": "npm", "args": ["run", "serve"]`; añade `"--"` para pasar opciones al script. npx conserva su comportamiento normal. |
| Otros .cmd/.bat | `cmd.exe /d /s /v:off /c`, rutas/args entre comillas. Admite espacios/acentos; rechaza comillas, `%`, `!`, `?`, `^`, `&`, `\|`, `<`, `>` y controles. El contenido del batch sigue siendo código ejecutable. |

## Ejecución y límites

- **Arranque:** reserva/libera puerto; un intento y hasta tres reintentos solo por conflictos de reserva, PID ajeno o `EADDRINUSE` en stderr. Cierra el intento anterior y conserva sus salidas. Automático/rango buscan de nuevo; fijo mantiene puerto. HTTP 503, timeout y fallos ordinarios no relanzan.
- **Propiedad y cierre:** `netstat` comprueba listener IPv4/PID; PowerShell/CIM acredita descendientes por parentesco y fecha. Rechaza listeners ajenos y propios en 0.0.0.0. Al cerrar, reiniciar o fallar el arranque, cancela operaciones y termina árboles comprobados con `taskkill /T /F`, incluso con padre salido. Si CIM falla, intenta terminar el proceso directo e informa. Son instantáneas: ramas no observadas, padres intermedios desaparecidos y cambios de puerto pueden impedir acreditar el árbol; no termina un servicio ajeno. No hay apagado suave ni protección ante muerte brusca de WebBox.
- **Recuperación:** errores de servidor permiten reintentar conservando ventana, perfil y log. Errores de página, caída o falta de respuesta del renderer permiten recargar conservando el servidor. Detached vigila puerto/PID; su pérdida/cambio muestra servidor detenido.
- **Navegación:** documentos principales/iframes solo HTTP en localhost/127.0.0.1 y puerto asignado, sin credenciales. Enlaces, redirecciones principales y ventanas externas se abren fuera solo con http/https/mailto; iframes externos se bloquean. Recursos/fetch siguen las reglas de Chromium.
- **Archivos y diálogos:** descarga HTTP/Blob mediante Guardar nativo, nombre saneado y confirmación de sobrescritura; cancelar al cerrar/sustituir vista, registrar resultado y avisar de fallo. Sin progreso/reanudación. Subida por `input type="file"`; alert/confirm nativos con protección frente a repetición; prompt no soportado.
- **Aislamiento y perfiles:** web sin Node/preload, con sandbox/contextIsolation; permisos especiales y de dispositivos denegados, incluido File System Access. Perfil en `userData/apps/SHA256(name normalizado a NFC)/session`, sensible a mayúsculas; nombres iguales comparten almacenamiento, sin bloqueo de instancia única.

## Log

Visor xterm.js de solo lectura, F12 desde web/log/carga/error. Estado Arrancando/Activo/Caído, stdout/stderr y marcas UTC; Limpiar, Copiar y Pausar/Reanudar autoscroll. Pausar conserva posición sin detener captura; Limpiar oculta el historial sin borrar archivos; Copiar usa el texto completo visible del buffer sin ANSI.

- Buffer: 10000 líneas lógicas, 4096 caracteres UTF-16 por línea (truncamiento indicado), fragmentos y CRLF/CR. ANSI: reset, negrita, 8 colores y variantes brillantes; descarta cursor/OSC/colores extendidos. Tras 128 spans conserva texto con el último estilo. xterm tiene 10000 filas físicas de scrollback; las líneas envueltas consumen varias.
- Disco: texto UTF-8 en `userData/apps/SHA256(name normalizado a NFC)/logs/`, nombre UTC+UUID por ejecución, 1 MiB más tres copias `.1`–`.3`, sin partir líneas. Reinicio conserva buffer/archivo. No recarga ni elimina conjuntos anteriores.
- Escritura asíncrona con cola de 1 MiB; error/exceso detiene el archivo, muestra causa y mantiene visor. Cierre normal guarda el fragmento final y espera escrituras.
