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

Última ejecución funcional: **17 de octubre de 2026**. Incluye modo estático y ejecutable portable de Singladura.

| Comprobación | Resultado |
| --- | --- |
| `npm.cmd test` | 88 aprobadas, 0 fallos; pruebas de empaquetado repetidas tras el ajuste final: 4 aprobadas. |
| `npm.cmd run test:smoke` | 32 checks de Launcher y 1 de entrada de producción aprobados; incluye HTML/CSS/módulos estáticos y cierre del puerto. |
| `npm.cmd run test:packaged` | Singladura desde el ASAR final: arranque, navegación Patrimonio/Liquidez, aislamiento y Web Crypto; captura obtenida. |
| `npm.cmd run test:portable` | EXE copiado solo a una carpeta temporal con espacios/acentos; arranque sin argumentos ni Node en PATH, web y ventana correctas, cierre libera puerto y proceso. |
| Sintaxis JavaScript | 35 archivos `.js` válidos en src/scripts/test. |
| Portable Singladura | `dist/singladura-0.1.0-win-x64.exe`, 101271688 bytes, sin firma. SHA-256 en `artifacts/package/portable-results.json`. |

Entorno: Windows 10.0.26300 x64, Node host 24.19.0, Electron 44.7.0 (Node 24.21.0), Python/py 3.12.0, escala 100 %. Informes de `artifacts/smoke/` a las 16:14 UTC y de `artifacts/package/` a las 16:20 UTC, excluidos de Git; regeneración y supervisión en DEVELOPMENT. Las pruebas requieren ejecución fuera del sandbox para conexiones loopback, enlaces de carpetas y CIM.

Cobertura Node: esquema/defaults/rutas, runtimes, TCP/HTTP/stdout, reserva/rango/fijo/carreras, PID ajeno/wildcard, reintentos/plazos/cancelación, descendientes/detached, logs/rotación y fallos de disco. Electron añade web real, recuperación, aislamiento/permisos, navegación/iframes, descargas/subida/diálogos, F12/foco/ANSI/acciones/DevTools, reinicio y cierre de hijo/nieto desde ventana y `before-quit`. Casos concretos en los tests y [smoke-checks.json](../test/smoke-checks.json).

### Límites de la evidencia

- `unresponsive` se simula por evento; la recuperación comprueba un nuevo PID del renderer. Destinos externos se recogen con callback, sin abrir navegador/correo del sistema.
- Perfiles distintos se prueban con dos Launcher en un proceso Electron; falta simultaneidad entre procesos independientes. Se verifican scripts reales Python/npm/detached, sin ejecución manual de cada manifiesto de ejemplo.
- Descargas: opciones de Guardar y bytes HTTP/Blob, con destino fijado por harness. Subida: selector interceptado con CDP y archivo real. Alert/confirm: JavaScript real, `showMessageBox` sustituido para comprobar ventana/opciones/respuestas. No se valida visualmente el diálogo ni selección/sobrescritura manual.
- Cierre: árboles y wrappers de los casos probados, no muerte brusca ni apagado suave. Las instantáneas PID/fecha no garantizan descubrir ramas no observadas; límites operativos en README.
- Solo escala 100 %; pendientes 125/150/200 %, zoom persistente y distribución general. El portable estático se ha probado en este equipo con solo el EXE y sin Node en PATH; falta validación en otro Windows limpio. No se ha probado instalador ni firma.

La aceptación de la distribución general del lanzador depende de completar y verificar los hitos 5–6; la variante portable estática ya se puede generar con las limitaciones indicadas.
