'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { app, BrowserWindow, WebContentsView, session, shell, ipcMain, dialog, clipboard, nativeTheme, nativeImage } = require('electron');
const { readManifest, parseArguments, applyOverrides } = require('./manifest');
const { readIcon } = require('./icons');
const { DocumentFiles, installDocumentBridge } = require('./document-files');
const { LocalServer } = require('./server');
const { StaticServer } = require('./static-server');
const { loadPage } = require('./load-page');
const { manageDownloads } = require('./downloads');
const { LogBuffer } = require('./log-buffer');
const { appIdentity, isAllowedNavigation, isExternalUrl, denyPermissions, restrictSessionNavigation } = require('./security');

const securePreferences = { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false };

class Launcher {
  constructor({ show = true, openExternal = url => shell.openExternal(url) } = {}) {
    this.show = show;
    this.openExternal = openExternal;
    this.window = null;
    this.webView = null;
    this.server = null;
    this.state = 'idle';
    this.error = null;
    this.closePromise = null;
    this.closing = false;
    this.pageLoadController = null;
    this.loadingPage = false;
    this.pageError = null;
    this.rendererUnresponsive = false;
    this.recoveringRenderer = false;
    this.statusRevision = 0;
    this.restarting = false;
    this.logs = new LogBuffer();
    this.activeView = 'content';
    this.logs.on('change', () => this.scheduleLogUpdate());
  }

  createWindow(manifest) {
    this.window = new BrowserWindow({
      ...(manifest?.window ?? { width: 820, height: 560 }),
      title: manifest?.title ?? this.options?.title ?? 'WebBox', icon: manifest?.icon,
      backgroundColor: this.backgroundColor(), show: false, autoHideMenuBar: true,
      webPreferences: {
        ...securePreferences, partition: 'webbox-status-' + randomUUID(),
        preload: path.join(__dirname, 'ui', 'status-preload.js')
      }
    });
    this.window.once('ready-to-show', () => {
      if (this.show && !this.closing) this.window.show();
    });
    this.themeHandler = () => {
      if (!this.closing && !this.window.isDestroyed()) {
        this.window.setBackgroundColor(this.backgroundColor());
        this.webView?.setBackgroundColor(this.backgroundColor());
      }
    };
    nativeTheme.on('updated', this.themeHandler);
    denyPermissions(this.window.webContents.session);
    this.window.setMenu(null);
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.configureKeys(this.window.webContents);
    this.createLogView();
    this.window.on('page-title-updated', event => event.preventDefault());
    this.window.on('resize', () => this.layout());
    this.window.on('close', event => {
      event.preventDefault();
      void this.close();
    });
    this.reloadHandler = event => {
      if (event.sender === this.window.webContents && !this.closing && this.pageError && !this.server?.failure) {
        void this.reloadWebPage();
      }
    };
    ipcMain.on('webbox:reload-page', this.reloadHandler);
    this.restartHandler = event => {
      if (event.sender === this.window.webContents) void this.restartServer();
    };
    this.exitHandler = event => {
      if (event.sender === this.window.webContents) void this.close();
    };
    ipcMain.on('webbox:restart-server', this.restartHandler);
    ipcMain.on('webbox:exit', this.exitHandler);
  }

  backgroundColor() {
    return nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3';
  }

  layout() {
    if (!this.window || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    for (const view of [this.webView, this.logView]) view?.setBounds({ x: 0, y: 0, width, height });
  }

  createLogView() {
    this.logView = new WebContentsView({ webPreferences: {
      ...securePreferences, devTools: !!this.options?.debug, partition: 'webbox-log-' + randomUUID(),
      preload: path.join(__dirname, 'ui', 'log-preload.js')
    } });
    const contents = this.logView.webContents;
    denyPermissions(contents.session);
    contents.on('will-navigate', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.configureKeys(contents, true);
    this.logActionHandler = (event, action, packet) => {
      if (this.closing || event.sender !== contents || event.senderFrame !== contents.mainFrame) return;
      if (action === 'ack') {
        if (packet !== this.logPacket) return;
        this.logInFlight = false;
        if (this.logSentKey !== this.logs.revision + ':' + this.state || this.logNotice) this.scheduleLogUpdate();
        return;
      }
      if (action === 'snapshot') this.logInFlight = false;
      if (action === 'clear') this.logs.clear();
      if (action === 'copy') {
        void clipboard.writeText(this.logs.text()).then(() => this.sendLogUpdate('Log copiado.'))
          .catch(error => this.sendLogUpdate('No se pudo copiar: ' + error.message));
      }
      else if (action === 'snapshot' || action === 'clear') this.sendLogUpdate();
    };
    ipcMain.on('webbox:log-action', this.logActionHandler);
    this.window.contentView.addChildView(this.logView);
    this.logView.setVisible(false);
    this.layout();
    this.logLoadPromise = contents.loadFile(path.join(__dirname, 'ui', 'log.html')).then(() => {
      this.logReady = true;
      this.sendLogUpdate();
      this.refreshViews();
    }).catch(error => {
      if (!this.closing) { this.logLoadError = error; this.activeView = 'content'; this.refreshViews(); }
    });
  }

  configureKeys(contents, debuggable = false) {
    contents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        event.preventDefault();
        if (input.type !== 'keyDown' || input.isAutoRepeat || this.closing) return;
        if (input.control && input.shift && !input.alt && !input.meta) {
          if (this.options?.debug && debuggable) {
            if (contents.isDevToolsOpened()) contents.closeDevTools();
            else contents.openDevTools({ mode: 'detach' });
          }
        } else if (!input.control && !input.shift && !input.alt && !input.meta) {
          this.activeView = this.activeView === 'log' ? 'content' : 'log';
          this.refreshViews(); this.sendLogUpdate();
        }
      } else if (input.control && input.shift && ['i', 'j'].includes(input.key.toLowerCase())) event.preventDefault();
    });
  }

  refreshViews() {
    if (this.closing || !this.window || this.window.isDestroyed()) return;
    const log = this.activeView === 'log' && this.logReady;
    this.logView?.setVisible(log);
    this.webView?.setVisible(!log && this.state === 'running');
    const contents = log ? this.logView.webContents : this.state === 'running' && this.webView ? this.webView.webContents : this.window.webContents;
    contents.focus();
  }

  scheduleLogUpdate() {
    if (this.closing || this.logTimer || this.activeView !== 'log') return;
    this.logTimer = setTimeout(() => { this.logTimer = null; this.sendLogUpdate(); }, 100);
  }

  sendLogUpdate(message = '') {
    if (message) this.logNotice = message;
    if (this.closing || !this.logReady || !this.logView || this.logView.webContents.isDestroyed() || this.logInFlight) return;
    this.logInFlight = true;
    this.logPacket = (this.logPacket ?? 0) + 1;
    this.logSentKey = this.logs.revision + ':' + this.state;
    this.logView.webContents.send('webbox:log-data', {
      ...this.logs.visibleSnapshot(), title: this.manifest?.title ?? this.options?.title ?? 'WebBox', state: this.state,
      packet: this.logPacket, message: this.logNotice || (this.state === 'error' ? this.error?.message : '') || ''
    });
    this.logNotice = '';
  }

  async status(state, message, details = '', kind = 'startup') {
    if (this.closing || this.window?.isDestroyed()) return;
    const revision = ++this.statusRevision;
    this.state = state;
    this.errorKind = kind;
    this.logs.write(state === 'error' ? 'stderr' : 'stdout', '[WebBox] ' + message + '\n');
    this.scheduleLogUpdate();
    if (this.webView) this.webView.setVisible(false);
    try {
      await this.window.loadFile(path.join(__dirname, 'ui', state === 'error' ? 'status.html' : 'loading.html'), {
        query: {
          state, kind, title: this.manifest?.title ?? this.options?.title ?? 'WebBox', message, details,
          reload: String(kind === 'page' && !!this.server?.ready && !this.server?.failure),
          retry: String(state === 'error' && kind !== 'page' && !!this.manifest && !this.restarting)
        }
      });
      if (revision === this.statusRevision && !this.closing) this.refreshViews();
    } catch (error) {
      if (revision === this.statusRevision && !this.closing) throw error;
    }
  }

  configureWebView() {
    const contents = this.webView.webContents;
    this.configureKeys(contents, true);
    const server = this.server;
    this.removeDownloadPolicy = manageDownloads(contents, {
      directory: app.getPath('downloads'),
      log: text => server.log('stdout', text),
      failed: message => {
        if (this.closing || this.window.isDestroyed()) return;
        void dialog.showMessageBox(this.window, {
          type: 'error', title: 'WebBox: descarga', message, buttons: ['Aceptar']
        }).catch(error => server.log('stderr', '[WebBox] ' + error.message + '\n'));
      }
    });
    const allowedPrefixes = this.manifest.navigation.allowedPrefixes;
    this.removeNavigationPolicy = restrictSessionNavigation(contents.session, contents.id, this.server.port, this.options.debug, allowedPrefixes);
    const external = value => {
      if (isExternalUrl(value)) {
        Promise.resolve().then(() => this.openExternal(value)).catch(error => {
          if (!this.closing) {
            this.pageError = new Error('No se pudo abrir el enlace externo: ' + error.message);
            this.error = this.pageError;
            void this.status('error', this.error.message, '', 'page').catch(() => {});
          }
        });
      }
    };
    const navigate = event => {
      if (!isAllowedNavigation(event.url, this.server.port, allowedPrefixes)) {
        event.preventDefault();
        if (event.isMainFrame !== false) external(event.url);
      }
    };
    // will-frame-navigate cubre también subframes; will-redirect cubre HTTP 3xx.
    contents.on('will-frame-navigate', navigate);
    contents.on('will-redirect', navigate);
    contents.setWindowOpenHandler(({ url }) => {
      external(url);
      return { action: 'deny' };
    });
    contents.on('render-process-gone', (_event, details) => {
      if (contents !== this.webView?.webContents) return;
      if (this.recoveringRenderer) return;
      this.handlePageFailure(new Error('La vista web se ha detenido (' + details.reason + '). Puedes volver a cargarla.'));
    });
    contents.on('unresponsive', () => {
      if (contents !== this.webView?.webContents) return;
      this.rendererUnresponsive = true;
      this.handlePageFailure(new Error('La vista web no responde. Puedes volver a cargarla.'));
    });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (contents !== this.webView?.webContents) return;
      if (isMainFrame && code !== -3 && this.state === 'running') {
        this.handlePageFailure(new Error('No se pudo cargar la página: ' + description + '.'));
      }
    });
  }

  handlePageFailure(error) {
    if (this.closing || this.server?.failure) return;
    this.pageError = error;
    this.error = error;
    this.pageLoadController?.abort(error);
    void this.status('error', error.message, this.server?.tail() ?? '', 'page').catch(() => {});
  }

  async loadWebPage() {
    this.pageError = null;
    this.pageLoadController = new AbortController();
    this.loadingPage = true;
    try {
      await loadPage(this.webView.webContents, this.url, this.manifest.ready.timeoutMs, this.pageLoadController.signal);
      if (this.closing) return;
      if (this.server.failure) throw this.server.failure;
      if (this.pageError) throw this.pageError;
      ++this.statusRevision;
      this.error = null;
      this.state = 'running';
      this.refreshViews();
      this.sendLogUpdate();
    } finally {
      this.loadingPage = false;
      this.pageLoadController = null;
    }
  }

  async reloadWebPage() {
    if (this.closing || this.loadingPage || !this.pageError || this.server?.failure) return;
    this.loadingPage = true;
    try {
      await this.status('starting', 'Volviendo a cargar la página…');
      if (this.closing) return;
      const contents = this.webView.webContents;
      if (this.rendererUnresponsive && !contents.isCrashed()) {
        this.recoveringRenderer = true;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('No se pudo reiniciar la vista web en 3000 ms.')), 3000);
        const gone = once(contents, 'render-process-gone', { signal: controller.signal });
        // Observa el rechazo aunque forcefullyCrashRenderer falle sincrónicamente.
        gone.catch(() => {});
        try {
          contents.forcefullyCrashRenderer();
          await gone;
        } finally {
          clearTimeout(timer);
          controller.abort();
          this.recoveringRenderer = false;
        }
      }
      this.rendererUnresponsive = false;
      if (!this.closing) await this.loadWebPage();
    } catch (error) {
      if (!this.closing && !this.server?.failure) this.handlePageFailure(error);
    } finally {
      this.loadingPage = false;
    }
  }

  async start(argv) {
    try {
      const embeddedManifestPath = app.isPackaged ? path.join(app.getAppPath(), 'embedded', 'app.app.json') : undefined;
      this.options = parseArguments(argv, {
        embeddedManifestPath: embeddedManifestPath && fs.existsSync(embeddedManifestPath) ? embeddedManifestPath : undefined
      });
      this.manifest = applyOverrides(await readManifest(this.options.manifestPath), this.options);
      if (this.manifest.icon) {
        await readIcon(this.manifest.icon, this.options.icon !== undefined ? '--icon' : 'icon del manifiesto');
        if (nativeImage.createFromPath(this.manifest.icon).isEmpty()) throw new Error('No se pudo decodificar el icono: ' + this.manifest.icon);
      }
      if (this.manifest.static && this.options.appArgs.length && !this.manifest.documents) {
        throw new Error('Esta aplicación es una web estática y no tiene un proceso Node o Python al que pasar argumentos.');
      }
      if (this.manifest.static && this.manifest.documents && this.options.appArgs.length > 1) throw new Error('Indica un único fichero o carpeta para abrir al arrancar.');
      if (this.manifest.documents) this.documents = new DocumentFiles({ extensions: this.manifest.documents.extensions,
        startupFile: this.manifest.static ? this.options.appArgs[0] : undefined,
        directory: app.getPath('documents'), dialog, window: () => this.window });
      if (this.closing) return this;
      // El hash evita usar nombres de manifiesto como rutas o identificadores de Chromium.
      this.profileDirectory = path.join(app.getPath('userData'), 'apps', appIdentity(this.manifest.name));
      const sessionPath = path.join(this.profileDirectory, 'session');
      fs.mkdirSync(sessionPath, { recursive: true });
      this.webSession = session.fromPath(sessionPath);
      this.logs.persist(path.join(this.profileDirectory, 'logs'));
      this.activeView = this.manifest.logOnStart ? 'log' : 'content';
      denyPermissions(this.webSession);
      this.createWindow(this.manifest);
      await this.status('starting', 'Preparando el servidor local…');
      if (this.closing) return this;
      await this.launchServer();
    } catch (error) {
      await this.startupFailure(error);
    }
    return this;
  }

  async launchServer() {
      const Server = this.manifest.static ? StaticServer : LocalServer;
      const server = this.server = new Server(this.manifest, this.logs, this.options.appArgs);
      server.on('down', error => {
        if (server !== this.server) return;
        if (!this.closing) {
          this.error = error;
          this.pageLoadController?.abort(error);
          void this.status('error', error.message, this.server.tail(), 'server').catch(() => {});
        }
      });
      this.url = await this.server.start();
      if (this.closing) return this;
      const documentChannel = this.documents ? 'webbox:documents:' + randomUUID() : null;
      const documentUrl = new URL(this.url);
      this.webView = new WebContentsView({ webPreferences: {
        ...securePreferences, devTools: !!this.options.debug, session: this.webSession, disableDialogs: false,
        ...(documentChannel ? { preload: path.join(__dirname, 'ui/document-preload.js'), additionalArguments: [
          '--webbox-documents-channel=' + documentChannel, '--webbox-documents-origin=' + documentUrl.origin,
          '--webbox-documents-path=' + documentUrl.pathname] } : {}),
        safeDialogs: true, safeDialogsMessage: 'Evitar que esta aplicación muestre más diálogos'
      } });
      if (this.documents) this.documentBridge = installDocumentBridge({ ipcMain, contents: this.webView.webContents,
        files: this.documents, origin: documentUrl.origin, pathname: documentUrl.pathname, channel: documentChannel });
      this.webView.setBackgroundColor(this.backgroundColor());
      this.configureWebView();
      this.webView.setVisible(false);
      this.window.contentView.addChildView(this.webView);
      // La vista de log debe permanecer por encima incluso si llega F12 durante la carga.
      this.window.contentView.removeChildView(this.logView);
      this.window.contentView.addChildView(this.logView);
      this.layout();
      await this.loadWebPage();
  }

  async startupFailure(error) {
      if (this.closing) return this;
      this.error = error;
      if (!this.window) this.createWindow(this.manifest && { ...this.manifest, icon: undefined });
      if (!this.pageError) await this.server?.stop().catch(stopError => {
        this.error = new Error(error.message + '\n' + stopError.message);
      });
      await this.status('error', this.error.message, this.server?.tail() ?? '', this.pageError ? 'page' : this.server?.ready && this.server.failure ? 'server' : 'startup');
  }

  async removeWebView() {
    await this.documentBridge?.dispose();
    this.documentBridge = null;
    this.removeDownloadPolicy?.();
    this.removeDownloadPolicy = null;
    this.removeNavigationPolicy?.();
    this.removeNavigationPolicy = null;
    const view = this.webView;
    this.webView = null;
    if (!view) return;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  async restartServer() {
    if (this.closing || this.restarting || this.state !== 'error' || this.errorKind === 'page' || !this.manifest) return;
    this.restarting = true;
    try {
      await this.status('starting', 'Reiniciando el servidor local…');
      await this.server?.stop();
      if (this.closing) return;
      await this.removeWebView();
      this.error = null;
      this.pageError = null;
      this.rendererUnresponsive = false;
      await this.launchServer();
    } catch (error) {
      this.restarting = false;
      await this.startupFailure(error);
    } finally {
      this.restarting = false;
    }
  }

  close() {
    this.closing = true;
    clearTimeout(this.logTimer);
    this.removeDownloadPolicy?.();
    this.pageLoadController?.abort(new Error('Carga cancelada al cerrar la ventana.'));
    this.closePromise ??= this.dispose();
    return this.closePromise;
  }

  async dispose() {
    try {
      await this.documentBridge?.dispose();
      await this.server?.stop();
    } catch (error) {
      this.error = error;
      dialog.showErrorBox('WebBox: cierre del servidor', error.message);
    } finally {
      await this.logs.close();
      this.removeDownloadPolicy?.();
      this.removeNavigationPolicy?.();
      if (this.reloadHandler) ipcMain.removeListener('webbox:reload-page', this.reloadHandler);
      if (this.restartHandler) ipcMain.removeListener('webbox:restart-server', this.restartHandler);
      if (this.exitHandler) ipcMain.removeListener('webbox:exit', this.exitHandler);
      if (this.logActionHandler) ipcMain.removeListener('webbox:log-action', this.logActionHandler);
      if (this.themeHandler) nativeTheme.removeListener('updated', this.themeHandler);
      if (this.logView && !this.logView.webContents.isDestroyed()) this.logView.webContents.close();
      if (this.webView && !this.webView.webContents.isDestroyed()) this.webView.webContents.close();
      if (this.window && !this.window.isDestroyed()) this.window.destroy();
      this.state = 'closed';
    }
  }
}

module.exports = { Launcher };
