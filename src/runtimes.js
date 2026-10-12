'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

function envValue(env, name) {
  return Object.entries(env).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];
}

function setEnv(env, name, value) {
  for (const key of Object.keys(env)) if (key.toUpperCase() === name.toUpperCase()) delete env[key];
  if (value !== undefined) env[name] = value;
}

async function executable(command, env) {
  const explicit = /[\\/]/.test(command);
  const extensions = path.extname(command) ? [''] : ['', '.exe', '.cmd', '.bat'];
  const directories = explicit ? [''] : (envValue(env, 'PATH') ?? '').split(';').map(item => item.replace(/^"|"$/g, '')).filter(Boolean);
  for (const directory of directories) for (const extension of extensions) {
    const candidate = explicit ? command + extension : path.join(directory, command + extension);
    try { if ((await fs.stat(candidate)).isFile()) return path.resolve(candidate); } catch {}
  }
  return null;
}

function pythonVersion(command, env, cwd, signal) {
  return new Promise(resolve => {
    execFile(command, ['--version'], { env, cwd, signal, timeout: 1500, windowsHide: true }, (error, stdout, stderr) => {
      resolve(!error && /^Python \d+\.\d+/m.test(stdout + stderr));
    });
  });
}

function batchInvocation(command, args) {
  // cmd expande %VAR% incluso dentro de comillas. Rechazar lo ambiguo evita
  // interpretar metacaracteres de un argumento como comandos nuevos.
  for (const [index, value] of [command, ...args].entries()) {
    if (/["%!?^&|<>\u0000-\u001f]/.test(value)) {
      throw new Error(`El ${index === 0 ? 'command' : 'args[' + (index - 1) + ']'} de un .cmd/.bat contiene caracteres no admitidos por la invocación segura.`);
    }
  }
  const line = '"' + [command, ...args].map(value => '"' + value + '"').join(' ') + '"';
  return { command: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
    args: ['/d', '/s', '/v:off', '/c', line], windowsVerbatimArguments: true };
}

async function resolveRuntime(command, args, env, cwd, signal) {
  signal.throwIfAborted();
  const name = path.basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (['python', 'python3', 'py'].includes(name)) {
    for (const candidate of name === 'py' ? [command] : [command, 'py']) {
      const resolved = await executable(candidate, env);
      signal.throwIfAborted();
      if (!resolved || /[\\/]WindowsApps[\\/]/i.test(resolved)) continue;
      if (await pythonVersion(resolved, env, cwd, signal)) {
        setEnv(env, 'PYTHONUNBUFFERED', '1');
        setEnv(env, 'PYTHONIOENCODING', 'utf-8');
        return { command: resolved, args, label: resolved };
      }
      signal.throwIfAborted();
    }
    throw new Error('No se encontró un Python válido ni el lanzador py. Instala Python desde https://www.python.org/downloads/windows/ y habilita su acceso por PATH; los alias de Microsoft Store no sirven.');
  }
  if (['npm', 'npx'].includes(name)) {
    const resolved = await executable(command, env);
    if (!resolved) throw new Error(`No se pudo ejecutar «${command}». Instala Node.js con npm/npx y comprueba PATH.`);
    const directory = path.dirname(resolved);
    const cli = path.join(directory, 'node_modules', 'npm', 'bin', name + '-cli.js');
    try { await fs.access(cli); } catch { throw new Error(`No se encontró el CLI de ${name} junto a ${resolved}. Reinstala Node.js/npm.`); }
    const node = await executable(path.join(directory, 'node.exe'), env) ?? await executable('node.exe', env);
    if (!node) throw new Error('No se pudo resolver node.exe para ejecutar ' + name + '.');
    return { command: node, args: [cli, ...args], label: name + ' (' + cli + ')' };
  }
  if (/\.(cmd|bat)$/i.test(command)) {
    const resolved = await executable(command, env);
    if (!resolved) throw new Error(`No se pudo ejecutar «${command}». Comprueba PATH y cwd (${cwd}).`);
    return { ...batchInvocation(resolved, args), label: resolved };
  }
  return { command, args, label: command };
}

module.exports = { resolveRuntime, executable, envValue, setEnv, batchInvocation };
