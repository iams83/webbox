# Arranque HTTP y puertos

Ejecutar desde la raíz del proyecto:

```powershell
npm.cmd start -- examples/http-ready/app.app.json
npm.cmd start -- examples/http-ready/fixed.app.json
npm.cmd start -- examples/http-ready/timeout.app.json
```

El servidor abre el puerto inmediatamente, pero `/health` responde 503 durante tres segundos. WebBox mantiene la pantalla de carga hasta recibir 204 y entonces abre la demo. `startUrl` sigue siendo `/`: la ruta de salud no es la página que se muestra.

- `app.app.json` utiliza el primer puerto libre entre 43000 y 43010, ambos incluidos.
- `fixed.app.json` exige 43000. Si ya está ocupado, WebBox muestra el conflicto sin cargar ni terminar el servicio existente. Para probarlo, mantén abierta primero la demo del rango.
- `timeout.app.json` prepara la aplicación durante cinco segundos, pero WebBox concede solo 1500 ms: muestra el error HTTP 503 y termina el proceso directo.

Cerrar durante la preparación cancela la espera y termina los procesos comprobados. Estos ejemplos sirven la demo, sin endpoints de descarga/subida; catálogo en [examples/README.md](../README.md).
