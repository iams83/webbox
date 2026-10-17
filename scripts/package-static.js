'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { readManifest } = require('../src/manifest');
const pkg = require('../package.json');

function parseOptions(argv) {
  const options = { output: path.resolve(__dirname, '../dist'), name: undefined, input: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (['--name', '--output'].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('Falta el valor de ' + arg + '.');
      options[arg === '--name' ? 'name' : 'output'] = value;
    } else if (arg.startsWith('--') || options.input) throw new Error('Argumento no válido: ' + arg);
    else options.input = arg;
  }
  if (!options.input) throw new Error('Uso: npm run package:static -- <archivo.html|carpeta-publica> --name MiApp [--output carpeta]');
  options.input = path.resolve(options.input);
  options.output = path.resolve(options.output);
  options.name ??= path.basename(options.input, path.extname(options.input));
  if (!options.name.trim() || options.name.length > 80 || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(options.name)
    || /[. ]$/.test(options.name)) throw new Error('--name debe ser un nombre de aplicación válido (1–80 caracteres).');
  options.slug = options.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'static-app';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(options.slug)) options.slug = 'app-' + options.slug;
  return options;
}

async function copyPublic(source, destination) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error('No se empaquetan enlaces simbólicos: ' + source);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const entry of await fs.readdir(source)) {
      // Evita incluir por accidente repositorios, perfiles y dependencias del proyecto.
      if (entry.startsWith('.') || entry === 'node_modules') throw new Error('La carpeta debe contener solo archivos públicos; se encontró: ' + path.join(source, entry));
      await copyPublic(path.join(source, entry), path.join(destination, entry));
    }
  } else if (stat.isFile()) {
    await fs.copyFile(source, destination);
  } else throw new Error('Tipo de archivo no admitido: ' + source);
}

async function prepareStatic(options, stage) {
  const stageRelative = path.relative(options.input, stage);
  if (!stageRelative || (!stageRelative.startsWith('..' + path.sep) && stageRelative !== '..' && !path.isAbsolute(stageRelative))) {
    throw new Error('La carpeta pública no puede contener el directorio temporal de empaquetado.');
  }
  const stat = await fs.lstat(options.input);
  const publicDir = path.join(stage, 'public');
  await fs.mkdir(publicDir);
  if (stat.isFile() && /\.html?$/i.test(options.input)) {
    await copyPublic(options.input, path.join(publicDir, 'index.html'));
  } else if (stat.isDirectory()) {
    // No permitas que una salida dentro de la entrada acabe incluida en sí misma.
    const relative = path.relative(options.input, options.output);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('--output debe estar fuera de la carpeta pública.');
    }
    await copyPublic(options.input, publicDir);
  } else throw new Error('La entrada debe ser un HTML autónomo o una carpeta pública sin enlaces simbólicos.');
  if (!(await fs.stat(path.join(publicDir, 'index.html'))).isFile()) throw new Error('La carpeta pública debe tener index.html.');
  const manifest = { name: options.name, title: options.name, static: { root: 'public' } };
  const filename = path.join(stage, 'app.app.json');
  await fs.writeFile(filename, JSON.stringify(manifest, null, 2) + '\n');
  await readManifest(filename);
  return manifest;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  if (process.platform !== 'win32') throw new Error('Este comando genera ejecutables para Windows y debe ejecutarse en Windows.');
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'webbox-static-'));
  try {
    await prepareStatic(options, stage);
    const { build, Platform, Arch } = require('electron-builder');
    const identity = createHash('sha256').update(options.name.normalize('NFC')).digest('hex');
    const artifacts = await build({
      projectDir: path.resolve(__dirname, '..'),
      targets: Platform.WINDOWS.createTarget('portable', Arch.x64),
      publish: 'never',
      config: {
        appId: 'webbox.static.' + identity,
        productName: options.name,
        executableName: options.slug,
        extraMetadata: { name: options.slug, description: 'Aplicación estática con WebBox: ' + options.name },
        directories: { output: options.output },
        electronVersion: pkg.devDependencies.electron,
        electronDist: path.resolve(__dirname, '../node_modules/electron/dist'),
        npmRebuild: false,
        asar: true,
        files: ['src/**/*', 'package.json', { from: stage, to: 'embedded', filter: ['**/*'] }],
        win: { target: 'portable', signExecutable: false },
        portable: { unpackDirName: false },
        artifactName: options.slug + '-${version}-win-${arch}.${ext}'
      }
    });
    const executables = artifacts.filter(artifact => artifact.toLowerCase().endsWith('.exe'));
    if (!executables.length) throw new Error('El empaquetador no ha generado un ejecutable portable.');
    for (const artifact of executables) {
      if (!(await fs.stat(artifact)).size) throw new Error('El ejecutable generado está vacío: ' + artifact);
      console.log('Ejecutable portable: ' + artifact);
    }
    return artifacts;
  } finally {
    // stage es exclusivamente el directorio creado por esta ejecución.
    if (path.dirname(stage) === path.resolve(os.tmpdir()) && path.basename(stage).startsWith('webbox-static-')) {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseOptions, prepareStatic };
