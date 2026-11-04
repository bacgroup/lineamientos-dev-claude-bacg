import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from '../vendor/js-yaml.mjs';

// Ruta de la copia de trabajo de lineamientos:
// LINEAMIENTOS_DIR > ~/.claude/como-trabajo-bacg.json (lineamientosDir) > default por plataforma.
export function dirLineamientos({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  if (env.LINEAMIENTOS_DIR) return env.LINEAMIENTOS_DIR;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'como-trabajo-bacg.json'), 'utf8'));
    if (cfg && typeof cfg.lineamientosDir === 'string' && cfg.lineamientosDir) return cfg.lineamientosDir;
  } catch {
    // archivo ausente o inválido: se sigue con el default
  }
  return platform === 'win32' ? path.win32.join('C:', 'MiCarpeta', 'lineamientos-bacg') : path.join(home, 'lineamientos-bacg');
}

// Carpeta del repo con la configuración del proyecto (proyecto.yml, reglas, resumen, canon, adr). Viaja con el
// repo: cualquier clon, cuenta o sesión en la nube la tiene sin una copia local de lineamientos.
export const CARPETA_REPO = '.como-trabajo';

// YAML de un archivo, o null si no existe, no es archivo o no se puede leer.
function yamlDe(archivo) {
  try {
    return fs.statSync(archivo).isFile() ? yaml.load(fs.readFileSync(archivo, 'utf8')) : null;
  } catch {
    return null;
  }
}

// Sube desde cwd hasta encontrar `.lineamientos` (línea `proyecto: <id>`) o `.como-trabajo/proyecto.yml` (con `id`).
export function buscarRepo(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const datos = yamlDe(path.join(dir, '.lineamientos'));
    if (datos && datos.proyecto) return { raiz: dir, proyectoId: String(datos.proyecto) };
    const enRepo = yamlDe(path.join(dir, CARPETA_REPO, 'proyecto.yml'));
    if (enRepo && enRepo.id) return { raiz: dir, proyectoId: String(enRepo.id) };
    const padre = path.dirname(dir);
    if (padre === dir) return null;
    dir = padre;
  }
}

/** ¿El repo trae su propia configuración en .como-trabajo/? */
export const configEnRepo = (raiz) => Boolean(raiz) && fs.existsSync(path.join(raiz, CARPETA_REPO, 'proyecto.yml'));

/** Carpeta del proyecto: `.como-trabajo/` del repo si existe (manda el repo); si no, `proyectos/<id>` de lineamientos. */
export function carpetaProyecto(id, dirLin, raiz) {
  return configEnRepo(raiz) ? path.join(raiz, CARPETA_REPO) : path.join(dirLin, 'proyectos', id);
}

export function cargarProyecto(id, dir, raiz) {
  const archivo = path.join(carpetaProyecto(id, dir, raiz), 'proyecto.yml');
  if (!fs.existsSync(archivo)) throw new Error(`Proyecto ${id} no registrado en ${dir}/proyectos`);
  return yaml.load(fs.readFileSync(archivo, 'utf8'));
}

/**
 * Nombre del repo de una carpeta: el del remoto origin (sin .git) o, si no hay remoto, el nombre de la carpeta.
 * Así un worktree en una carpeta con otro nombre sigue siendo el mismo repo para el circuito.
 */
export function nombreRepo(raiz) {
  const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: raiz, encoding: 'utf8' });
  const url = r.status === 0 ? r.stdout.trim() : '';
  const deUrl = url ? url.replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/i, '') : '';
  return deUrl || path.basename(raiz);
}
