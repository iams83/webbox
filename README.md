# WebBox

Lanzador de servidores web locales para **Windows**, escrito en JavaScript con Electron. Lee un manifiesto, ejecuta el servidor sin consola y muestra su web en una ventana nativa sin menú ni barra de direcciones.

**Estado:** prototipo funcional del hito 1, con navegación restringida, perfiles por aplicación y recuperación de la vista web. Todavía no hay ejecutable distribuible ni instalador.

## Puesta en marcha

Requisitos: Windows, Node.js **>=22.12.0** y npm. El runtime del servidor debe estar instalado; el ejemplo necesita `node` en PATH.

```powershell
npm.cmd ci
npm.cmd run demo
# Otro manifiesto:
npm.cmd start -- "C:\Mis aplicaciones\España\aplicación.app.json"
```

El ejemplo completo está en [examples/node](examples/node). El manifiesto mínimo para un `server.js` situado junto al JSON es:

```json
{
  "name": "mi-app",
  "command": "node",
  "args": ["server.js"]
}
```

El servidor debe escuchar **solo en 127.0.0.1**, usando el puerto recibido en `PORT`. WebBox admite HTTP local. Cierra la ventana para salir; los errores permanecen visibles hasta cerrarla.

**Ejecuta únicamente manifiestos de confianza:** el prototipo lanza el comando sin pedir aprobación. `--debug` y `--trust` se aceptan, pero todavía no cambian el comportamiento.

## Manifiesto actual

Se lee JSON UTF-8, con o sin BOM. Los campos desconocidos, caracteres NUL y opciones no implementadas producen errores indicando el campo. Los objetos omitidos o parciales reciben sus valores predeterminados.

| Campo | Valor predeterminado y contrato |
| --- | --- |
| `name` | Obligatorio; texto no vacío. Identifica el perfil persistente. |
| `command` | Obligatorio; ejecutable resuelto por PATH o ruta. No admite una línea de shell como `npm start`. |
| `title` | `name`; título nativo, independiente del título de la web. |
| `icon` | Sin ruta personalizada; se usa el icono de Electron. |
| `args` | `[]`; textos separados, con sustitución de `{PORT}`. |
| `cwd` | Carpeta del manifiesto. |
| `env` | `{}`; valores de texto añadidos al entorno heredado, con sustitución de `{PORT}`. |
| `port.mode` / `port.name` | `"env"` / `"PORT"`; se asigna un puerto libre a esa variable, prevaleciendo sobre `env`. |
| `ready.type` | `"port"`; espera a que el puerto TCP abra. |
| `ready.timeoutMs` | `30000`; entero de 1 a 120000 ms. Se aplica por separado a la espera del puerto y a cada carga de la página. |
| `startUrl` | `"/"`; ruta local que comienza por `/`, sin `//` inicial, barras inversas ni controles. |
| `window.width` / `height` | `1100` / `760` píxeles lógicos. |
| `window.minWidth` / `minHeight` | `480` / `320` píxeles lógicos. Los cuatro tamaños admiten enteros de 200 a 16384. |

`cwd`, `icon` y `command` con separadores se resuelven desde la carpeta del manifiesto. Los argumentos se transmiten literalmente salvo `{PORT}`; el runtime interpreta sus rutas desde `cwd`. La ejecución usa `spawn` con `shell: false` y `windowsHide: true`.

Solo se admiten `port.mode: "env"` y `ready.type: "port"`. Se rechazan `port.fixed`, `port.range`, `ready.path` y `ready.pattern`. `detached`, `singleInstance`, `logOnStart` y `window.rememberBounds` pueden omitirse o valer `false`; `true` se rechaza.

## Comportamiento y límites

- **Arranque:** reserva un puerto en 127.0.0.1, libera la reserva y lanza el servidor. No reintenta si otro proceso ocupa el puerto. Captura stdout/stderr en UTF-8 y muestra sus últimas salidas ante errores.
- **Recuperación:** la caída del servidor muestra un error. La caída, falta de respuesta o fallo de navegación de la vista web permite recargarla conservando el servidor. No hay botón de reinicio del servidor.
- **Cierre:** cancela la carga y termina el proceso directo, con hasta 6 segundos para confirmar su cierre. En Windows la terminación es forzada. No garantiza el cierre de descendientes ni protege ante la muerte brusca del launcher.
- **Navegación:** los documentos principales y subframes solo pueden usar HTTP en localhost o 127.0.0.1 y el puerto asignado, sin credenciales. Los destinos externos de enlaces/redirecciones principales y ventanas nuevas se abren fuera de WebBox solo si son http/https/mailto; los subframes externos se bloquean. Recursos y fetch siguen las reglas de Chromium y no pasan por este filtro.
- **Aislamiento:** la web no recibe Node.js ni preload; usa sandbox y contextIsolation. Las sesiones deniegan permisos especiales y de dispositivos. Cada `name` determina un perfil en `userData/apps/SHA256(name normalizado a NFC)/session`, distinguiendo mayúsculas. Nombres iguales comparten almacenamiento; todavía no existe bloqueo de instancia única.

Faltan runtimes especiales Python/npm/.cmd, readiness HTTP/stdout, detached, cierre del árbol, F12/log persistente, confianza, zoom y empaquetado. El detalle está en los [hitos](docs/MILESTONES.md).

## Desarrollo

```powershell
npm.cmd test
npm.cmd run test:smoke
# Exigir también las tres capturas:
npm.cmd run test:smoke -- --require-captures
```

La suite Electron abre ventanas temporales y genera informes, perfiles y capturas en `artifacts/smoke/`, excluido de Git. Si el entorno restringe conexiones locales o escrituras, las pruebas necesitan ejecutarse con los permisos correspondientes.

Para ponerse al día: lee este README, la [guía de desarrollo](docs/DEVELOPMENT.md) y los [hitos y validación](docs/MILESTONES.md). Consulta la [especificación objetivo](docs/SPEC.md) al implementar funciones pendientes.
