'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { app, BrowserWindow, WebContentsView, session, shell, ipcMain, dialog } = require('electron');
const { readManifest, parseArguments } = require('./manifest');
const { LocalServer } = require('./server');
const { loadPage } = require('./load-page');
const { appIdentity, isLocalNavigation, isExternalUrl, denyPermissions, restrictSessionNavigation } = require('./security');

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
  }

  createWindow(manifest) {
    this.window = new BrowserWindow({
      ...(manifest?.window ?? { width: 820, height: 560 }),
      title: manifest?.title ?? 'WebBox', icon: manifest?.icon,
      backgroundColor: '#f5f7fb', show: this.show, autoHideMenuBar: true,
      webPreferences: {
        ...securePreferences, partition: 'webbox-status-' + randomUUID(),
        preload: path.join(__dirname, 'ui', 'status-preload.js')
      }
    });
    denyPermissions(this.window.webContents.session);
    this.window.setMenu(null);
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
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
  }

  layout() {
    if (!this.webView || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    this.webView.setBounds({ x: 0, y: 0, width, height });
  }

  async status(state, message, details = '', kind = 'startup') {
    if (this.closing || this.window?.isDestroyed()) return;
    const revision = ++this.statusRevision;
    this.state = state;
    if (this.webView) this.webView.setVisible(false);
    try {
      await this.window.loadFile(path.join(__dirname, 'ui', 'status.html'), {
        query: {
          state, kind, title: this.manifest?.title ?? 'WebBox', message, details,
          reload: String(kind === 'page' && !!this.server?.ready && !this.server?.failure)
        }
      });
      if (revision === this.statusRevision && !this.closing) this.window.webContents.focus();
    } catch (error) {
      if (revision === this.statusRevision && !this.closing) throw error;
    }
  }

  configureWebView() {
    const contents = this.webView.webContents;
    this.removeNavigationPolicy = restrictSessionNavigation(contents.session, contents.id, this.server.port);
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
      if (!isLocalNavigation(event.url, this.server.port)) {
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
      if (this.recoveringRenderer) return;
      this.handlePageFailure(new Error('La vista web se ha detenido (' + details.reason + '). Puedes volver a cargarla.'));
    });
    contents.on('unresponsive', () => {
      this.rendererUnresponsive = true;
      this.handlePageFailure(new Error('La vista web no responde. Puedes volver a cargarla.'));
    });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
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
      this.webView.setVisible(true);
      this.webView.webContents.focus();
      this.error = null;
      this.state = 'running';
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
      this.options = parseArguments(argv);
      this.manifest = await readManifest(this.options.manifestPath);
      if (this.closing) return this;
      // El hash evita usar nombres de manifiesto como rutas o identificadores de Chromium.
      this.profileDirectory = path.join(app.getPath('userData'), 'apps', appIdentity(this.manifest.name));
      const sessionPath = path.join(this.profileDirectory, 'session');
      fs.mkdirSync(sessionPath, { recursive: true });
      this.webSession = session.fromPath(sessionPath);
      denyPermissions(this.webSession);
      this.createWindow(this.manifest);
      await this.status('starting', 'Preparando el servidor local…');
      if (this.closing) return this;
      this.server = new LocalServer(this.manifest);
      this.server.on('down', error => {
        if (!this.closing) {
          this.error = error;
          this.pageLoadController?.abort(error);
          void this.status('error', error.message, this.server.tail(), 'server').catch(() => {});
        }
      });
      this.url = await this.server.start();
      if (this.closing) return this;
      this.webView = new WebContentsView({ webPreferences: { ...securePreferences, session: this.webSession } });
      this.configureWebView();
      this.webView.setVisible(false);
      this.window.contentView.addChildView(this.webView);
      this.layout();
      await this.loadWebPage();
    } catch (error) {
      if (this.closing) return this;
      this.error = error;
      if (!this.window) this.createWindow();
      if (!this.pageError) await this.server?.stop().catch(stopError => {
        this.error = new Error(error.message + '\n' + stopError.message);
      });
      await this.status('error', this.error.message, this.server?.tail() ?? '', this.pageError ? 'page' : this.server?.ready && this.server.failure ? 'server' : 'startup');
    }
    return this;
  }

  close() {
    this.closing = true;
    this.pageLoadController?.abort(new Error('Carga cancelada al cerrar la ventana.'));
    this.closePromise ??= this.dispose();
    return this.closePromise;
  }

  async dispose() {
    try {
      await this.server?.stop();
    } catch (error) {
      this.error = error;
      dialog.showErrorBox('WebBox: cierre del servidor', error.message);
    } finally {
      this.removeNavigationPolicy?.();
      if (this.reloadHandler) ipcMain.removeListener('webbox:reload-page', this.reloadHandler);
      if (this.webView && !this.webView.webContents.isDestroyed()) this.webView.webContents.close();
      if (this.window && !this.window.isDestroyed()) this.window.destroy();
      this.state = 'closed';
    }
  }
}

module.exports = { Launcher };
