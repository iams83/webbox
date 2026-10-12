# Ejemplos

Desde la raíz, ejecutar `npm.cmd start -- RUTA` con uno de estos manifiestos:

| Ruta | Comportamiento |
| --- | --- |
| `examples/node/app.app.json` | Node con puerto por variable de entorno y readiness TCP. |
| `examples/logging/app.app.json` | Abre el visor xterm.js al iniciar, con ANSI y salida periódica; F12 vuelve a la web. |
| `examples/process-tree/app.app.json` | Node directo con hijo y nieto detached; `/pids` muestra sus PID para comprobar el cierre. |
| `examples/http-ready/app.app.json` | Puerto por rango y preparación lenta; espera HTTP 204 en `/health`. |
| `examples/http-ready/fixed.app.json` | El mismo servidor en el puerto fijo 43000. |
| `examples/http-ready/timeout.app.json` | Fallo deliberado por timeout de preparación; permite reintentar. |
| `examples/python/app.app.json` | Python con UTF-8 sin buffer y readiness stdout. Necesita Python o `py` instalados. |
| `examples/npm/app.app.json` | npm ejecuta un servidor descendiente; no requiere instalar dependencias del ejemplo. |
| `examples/detached/app.app.json` | El comando inicial sale 0; WebBox vigila y cierra el servidor por puerto. |
| `examples/port-args/app.app.json` | WebBox añade `--port PUERTO`; espera el patrón stdout `READY`. |
| `examples/port-args/placeholder.app.json` | WebBox sustituye `{PORT}` en args sin imponer una variable de entorno. |

Todos escuchan en 127.0.0.1 y reutilizan la demo. Node, logging, npm y detached ejecutan el servidor Node con descarga UTF-8 y subida sin almacenamiento; HTTP-ready, Python, port-args y process-tree solo sirven la página, sin endpoints de descarga/subida. Alert/confirm funcionan en todos. Cerrar la ventana termina los descendientes comprobados; protección ante muerte brusca pendiente.
