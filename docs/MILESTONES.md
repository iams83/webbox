# Hitos y validación

El contrato disponible está en el [README](../README.md); los requisitos completos, en [SPEC.md](SPEC.md). Las funciones adelantadas no completan sus hitos.

| Hito | Alcance | Estado |
| --- | --- | --- |
| 1 | Prototipo Node, servidor oculto, ventana y WebContentsView | Implementado y verificado. |
| 2 | Esquema, puertos/reintentos, HTTP/stdout, runtimes y detached | Pendiente. |
| 3 | Navegación, descargas/diálogos y cierre del árbol, también por puerto | Navegación implementada; resto pendiente. |
| 4 | F12, log por líneas/ANSI, acciones y rotación | Pendiente. |
| 5 | Robustez, protección ante muerte brusca, apagado suave, confianza, instancia única, zoom/escalado | Sesiones por nombre y recuperación de vista implementadas; resto pendiente. |
| 6 | electron-builder, NSIS, portable, icono, asociación y firma | Pendiente. |

## Última verificación: 12 de octubre de 2026

| Comprobación | Resultado |
| --- | --- |
| `npm.cmd test` | 23 pruebas aprobadas. |
| `npm.cmd run test:smoke -- --require-captures` | 13 comprobaciones de Launcher y 1 de la entrada de producción aprobadas. |
| Sintaxis JavaScript | Todos los archivos del proyecto válidos. |
| Capturas | demo, error y renderer-error obtenidas e inspeccionadas: texto y botón legibles, sin recortes. |

Entorno: Windows 10.0.26300 x64, Node del host 24.19.0, Electron 44.7.0 (Node integrado 24.21.0), escala 100 %. Los informes locales en `artifacts/smoke/` fueron generados a las 10:14 UTC; se regeneran con las pruebas y no se versionan. La [guía de desarrollo](DEVELOPMENT.md) explica su supervisión y validación.

Cobertura: manifiestos y rutas con espacios/acentos, servidores Node reales, runtime ausente, salida prematura, timeout TCP/HTTP, cancelación al cerrar, caída/recarga real del renderer, servidor detenido, navegación local/externa, redirecciones, ventanas, iframe externo, aislamiento de cookies y permisos denegados.

Límites de esta evidencia:

- La vista sin respuesta se provoca emitiendo el evento unresponsive; la recuperación sí verifica un PID de renderer nuevo.
- Los destinos externos se recogen con un callback de prueba; no se prueba la apertura de navegador/correo del sistema.
- Las sesiones de nombres distintos se prueban con dos Launcher en un proceso Electron, no con dos procesos independientes.
- Cierre verificado del proceso directo; descendientes, detached y muerte brusca de producción siguen pendientes.
- Solo se verificó escala 100 %; no acredita 125/150/200 %, zoom persistente, otros runtimes ni distribución.

Los criterios finales de aceptación siguen pendientes hasta implementar y probar los hitos correspondientes.
