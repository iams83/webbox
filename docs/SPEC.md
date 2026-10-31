# Requisitos pendientes

El [README](../README.md) define el contrato implementado; [MILESTONES](MILESTONES.md) registra evidencia. Este documento conserva solo el trabajo restante para la versión Windows distribuible. Mantener los comportamientos existentes mediante las suites de DEVELOPMENT.

## Hito 5: robustez

| Función | Requisito y aceptación |
| --- | --- |
| Muerte brusca del launcher | Evitar servidores huérfanos al matar/crashear WebBox. Evaluar Job Object o watchdog independiente, documentar decisión y probar descendientes/detached. Preferir evitar dependencias nativas si el watchdog resulta suficientemente fiable. |
| Apagado suave | Intentar cierre cooperativo con plazo corto; después forzar árbol con `taskkill /T /F /PID` y confirmar terminación. Cubrir cerrar ventana, salir de Electron, reiniciar y cancelar arranque. Definir protocolo/plazo antes de implementarlo. |
| Confianza | Antes de primera ejecución mostrar command/args/cwd y solicitar aprobación. Recordarla por hash del fichero y pedirla de nuevo si cambia. `--trust` omite el aviso; documentar que permite ejecutar código sin confirmación. |
| `singleInstance` | Default `false`; con `true`, bloqueo por aplicación y foco en la existente. Establecer identidad/rutas antes de `requestSingleInstanceLock`; `additionalData` transporta datos, no identifica el bloqueo. Verificar nombres iguales/distintos en procesos independientes; con `false`, admitir varias instancias. |
| `window.rememberBounds` | Default `false`; con `true`, persistir tamaño/posición y restaurar una ventana visible con la configuración de pantallas actual. |
| Zoom y escalado | Ctrl+rueda y Ctrl+/-/0, zoom persistente por aplicación. Verificar web y pantallas locales al 125 %, 150 % y 200 %, sin recortes ni pérdida de controles/foco. |

Conservar aislamiento por nombre, recuperación de renderer/servidor y rutas con espacios/acentos. Añadir pruebas reales de simultaneidad en procesos separados y cierre al matar el launcher, además de la cobertura actual.

## Hito 6: distribución

- Ampliar el empaquetado electron-builder (ya disponible para portable estático) con instalador NSIS y distribución general del lanzador; completar metadatos e icono propios.
- Verificar la CLI ya implementada con el instalador y la distribución general: `launcher.exe ruta\al\manifiesto.app.json [--debug] [--trust] [-- argumentos]`, o `--manifest ruta` para elegir otro manifiesto desde un EXE con uno integrado. Uso/JSON inválidos deben mostrar el diagnóstico con el tema del sistema, sin consola.
- NSIS: implementar y verificar asociación de la extensión compuesta `.app.json`. Portable: ruta por CLI o arrastrar manifiesto sobre el ejecutable.
- Documentar firma Authenticode, credenciales fuera del repositorio y relación con SmartScreen, sin prometer eliminar todos los avisos.
- Probar instalación, desinstalación, portable y asociación según la configuración entregada; ejecutar ejemplos Node, Python, HTTP lento/fallo, npm/descendientes y detached con la distribución.

## Criterio de cierre

Registrar entorno y resultados reales por hito. No atribuir a mocks ni a las pruebas del código fuente una validación de diálogos manuales, instaladores o firma. Completar los requisitos pendientes, mantener verdes las suites actuales y actualizar contrato/estado antes de declarar lista la distribución.

Fuera de alcance: HTTPS del servidor, shell/PTY interactiva, prompt y gestor de progreso/reanudación de descargas.
