# Estado y validación

[README](../README.md): contrato disponible. [DEVELOPMENT](DEVELOPMENT.md): código/pruebas. [SPEC](SPEC.md): requisitos pendientes.

| Hito | Alcance | Estado |
| --- | --- | --- |
| 1 | Servidor Node oculto, ventana y WebContentsView | Completo. |
| 2 | Esquema, puertos/reintentos, HTTP/stdout, runtimes y detached | Completo. |
| 3 | Navegación, descargas/diálogos y cierre de árboles | Completo. |
| 4 | F12, xterm/ANSI, acciones y logs rotados | Completo. |
| 5 | Muerte brusca, apagado suave, confianza, instancia única, bounds/zoom/escalado | Pendiente; perfiles y recuperación ya disponibles. |
| 6 | electron-builder, NSIS, portable, icono, asociación y firma | Pendiente. |

**Siguiente desarrollo:** hito 5, primero protección ante muerte brusca y apagado suave. Criterios y decisiones por resolver en SPEC.

## Validación

Última ejecución funcional: **12 de octubre de 2026**. Revisión documental posterior sin cambios funcionales.

| Comprobación | Resultado |
| --- | --- |
| `npm.cmd test` | 78 aprobadas, 0 fallos. |
| `npm.cmd run test:smoke -- --require-captures` | 31 checks de Launcher y 1 de entrada de producción aprobados. |
| Sintaxis JavaScript | 36 archivos válidos. |
| Capturas | demo, error, renderer-error y log obtenidas e inspeccionadas; texto/botones/colores legibles, sin recortes. |

Entorno: Windows 10.0.26300 x64, Node host 24.19.0, Electron 44.7.0 (Node 24.21.0), Python/py 3.12.0, escala 100 %. Informes locales de `artifacts/smoke/` a las 13:33 UTC, excluidos de Git; regeneración y supervisión en DEVELOPMENT.

Cobertura Node: esquema/defaults/rutas, runtimes, TCP/HTTP/stdout, reserva/rango/fijo/carreras, PID ajeno/wildcard, reintentos/plazos/cancelación, descendientes/detached, logs/rotación y fallos de disco. Electron añade web real, recuperación, aislamiento/permisos, navegación/iframes, descargas/subida/diálogos, F12/foco/ANSI/acciones/DevTools, reinicio y cierre de hijo/nieto desde ventana y `before-quit`. Casos concretos en los tests y [smoke-checks.json](../test/smoke-checks.json).

### Límites de la evidencia

- `unresponsive` se simula por evento; la recuperación comprueba un nuevo PID del renderer. Destinos externos se recogen con callback, sin abrir navegador/correo del sistema.
- Perfiles distintos se prueban con dos Launcher en un proceso Electron; falta simultaneidad entre procesos independientes. Se verifican scripts reales Python/npm/detached, sin ejecución manual de cada manifiesto de ejemplo.
- Descargas: opciones de Guardar y bytes HTTP/Blob, con destino fijado por harness. Subida: selector interceptado con CDP y archivo real. Alert/confirm: JavaScript real, `showMessageBox` sustituido para comprobar ventana/opciones/respuestas. No se valida visualmente el diálogo ni selección/sobrescritura manual.
- Cierre: árboles y wrappers de los casos probados, no muerte brusca ni apagado suave. Las instantáneas PID/fecha no garantizan descubrir ramas no observadas; límites operativos en README.
- Solo escala 100 %; pendientes 125/150/200 %, zoom persistente y pruebas de distribución.

La aceptación de la versión distribuible depende de completar y verificar los hitos 5–6.
