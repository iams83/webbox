'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const MAX_BYTES = 25 * 1024 * 1024;
const digest = data => createHash('sha256').update(data).digest('hex');
async function readBytes(filename) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('El documento debe ser un archivo de hasta 25 MB.');
  const bytes = await fs.readFile(filename);
  if (bytes.length > MAX_BYTES) throw new Error('El documento supera los 25 MB.');
  return bytes;
}

class DocumentFiles {
  constructor({ extensions, startupFile, directory, dialog, window }) {
    this.extensions = extensions;
    this.startupFile = startupFile ? path.resolve(process.env.PORTABLE_EXECUTABLE_DIR || process.cwd(), startupFile) : null;
    this.directory = this.startupFile ? path.dirname(this.startupFile) : directory;
    this.dialog = dialog;
    this.window = window;
    this.current = this.pending = null;
  }
  checkExtension(filename) {
    if (!this.extensions.includes(path.extname(filename).slice(1).toLowerCase())) throw new Error('Extensión de documento no permitida.');
  }
  metadata(record) { return { name: path.basename(record.path), path: record.path }; }
  async read(filename) {
    const resolved = await fs.realpath(filename);
    this.checkExtension(resolved);
    const content = await readBytes(resolved);
    this.pending = { id: randomUUID(), path: resolved, digest: digest(content) };
    return { ...this.metadata(this.pending), id: this.pending.id, content: content.toString('utf8') };
  }
  async initial() {
    if (this.current) return this.read(this.current.path);
    if (!this.startupFile) return null;
    if (!(await fs.stat(this.startupFile)).isDirectory()) return this.read(this.startupFile);
    this.directory = await fs.realpath(this.startupFile);
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const filename = entries.filter(entry => entry.isFile() && this.extensions.includes(path.extname(entry.name).slice(1).toLowerCase()))
      .map(entry => entry.name).sort().at(-1);
    if (!filename) throw new Error('La carpeta no contiene documentos con las extensiones permitidas: ' + this.extensions.map(extension => '.' + extension).join(', ') + '.');
    return this.read(path.join(this.directory, filename));
  }
  async open() {
    const result = await this.dialog.showOpenDialog(this.window(), { title: 'Abrir documento',
      defaultPath: this.current ? path.dirname(this.current.path) : this.directory,
      filters: [{ name: 'Documentos', extensions: this.extensions }], properties: ['openFile'] });
    return result.canceled || !result.filePaths?.length ? null : this.read(result.filePaths[0]);
  }
  activate(id) {
    if (!this.pending || this.pending.id !== id) throw new Error('La selección de documento ya no es válida.');
    this.current = this.pending; this.pending = null; this.startupFile = null;
    this.directory = path.dirname(this.current.path);
    return this.metadata(this.current);
  }
  reset() { this.current = this.pending = null; this.startupFile = null; }
  async save({ content, saveAs = false, suggestedName = 'document.json' } = {}) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES) throw new Error('El documento debe ser texto de hasta 25 MB.');
    let destination = this.current?.path;
    let expected = !saveAs ? this.current?.digest : undefined;
    if (saveAs || !destination) {
      const result = await this.dialog.showSaveDialog(this.window(), { title: 'Guardar como',
        defaultPath: destination || path.join(this.directory, path.basename(suggestedName)),
        filters: [{ name: 'Documentos', extensions: this.extensions }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
      if (result.canceled || !result.filePath) return null;
      destination = path.resolve(result.filePath);
      if (!path.extname(destination)) destination += '.' + this.extensions[0];
      try { destination = await fs.realpath(destination); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        destination = path.join(await fs.realpath(path.dirname(destination)), path.basename(destination));
      }
      expected = undefined;
    }
    this.checkExtension(destination);
    let previous;
    try { previous = await readBytes(destination); }
    catch (error) { if (error.code !== 'ENOENT' || expected !== undefined) throw error; }
    if (expected !== undefined && digest(previous) !== expected) throw new Error('El fichero ha cambiado fuera de la aplicación. Vuelve a abrirlo o utiliza «Guardar como…».');
    const before = previous ? digest(previous) : null;
    const temporary = path.join(path.dirname(destination), '.' + path.basename(destination) + '.' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      let latest;
      try { latest = digest(await readBytes(destination)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; latest = null; }
      if (latest !== before) throw new Error('El fichero ha cambiado durante el guardado. Los datos se conservan en la aplicación.');
      await fs.rename(temporary, destination);
      this.current = { path: destination, digest: digest(Buffer.from(content, 'utf8')) };
      this.directory = path.dirname(destination); this.pending = null; this.startupFile = null;
      return this.metadata(this.current);
    } finally {
      await handle?.close();
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

function installDocumentBridge({ ipcMain, contents, files, origin, pathname, channel = 'webbox:documents:' + randomUUID() }) {
  let active = null, disposed = false;
  const handler = async (event, action, input) => {
    let authorized = false;
    try { const url = new URL(event.senderFrame.url); authorized = url.origin === origin && url.pathname === pathname; } catch {}
    if (disposed || event.sender !== contents || event.senderFrame !== contents.mainFrame || !authorized) throw new Error('Acceso a documentos no autorizado.');
    if (!['initial', 'open', 'activate', 'save', 'reset'].includes(action)) throw new Error('Operación de documentos no válida.');
    if (active) throw new Error('Ya hay una operación de archivos en curso.');
    active = Promise.resolve().then(() => files[action](input));
    try { return await active; } finally { active = null; }
  };
  ipcMain.handle(channel, handler);
  return { channel, async dispose() { disposed = true; ipcMain.removeHandler(channel); await active?.catch(() => {}); } };
}

module.exports = { DocumentFiles, installDocumentBridge };
