import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} falló: ${r.stderr}`);
  return r.stdout;
}

// Crea un repo git temporal (con un espacio en la ruta) y devuelve su ruta.
// Con `nombre`, el repo queda en <dir temporal>/<nombre> (para que su basename coincida con proyecto.repos).
export function crearRepoTemporal({ proyectoId, archivos = {}, nombre } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'como trabajo-'));
  const dir = nombre ? path.join(base, nombre) : base;
  if (nombre) fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  if (proyectoId) fs.writeFileSync(path.join(dir, '.lineamientos'), `proyecto: ${proyectoId}\n`);
  for (const [rel, contenido] of Object.entries(archivos)) {
    const destino = path.join(dir, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'inicial');
  return dir;
}

// Ejecuta plugin/scripts/hooks/<nombre>.mjs con la entrada JSON por stdin.
export function correrHook(nombre, entradaJson, env = {}) {
  const script = path.join(RAIZ, 'plugin', 'scripts', 'hooks', `${nombre}.mjs`);
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(entradaJson),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
