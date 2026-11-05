import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from '../vendor/js-yaml.mjs';

// Ruta de la copia de trabajo de lineamientos:
// BACG_LINEAMIENTOS_DIR > ~/.claude/bacg-dev.json (lineamientosDir: una ruta o una lista; vale la primera que existe)
// > default por plataforma. La lista sirve en la nube: primero el repo que el entorno clona junto a los del proyecto
// (el que se commitea y pushea), y como respaldo la copia del setup.
export function dirLineamientos({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  if (env.BACG_LINEAMIENTOS_DIR) return env.BACG_LINEAMIENTOS_DIR;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'bacg-dev.json'), 'utf8'));
    const v = cfg?.lineamientosDir;
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v)) {
      const rutas = v.filter((x) => typeof x === 'string' && x);
      const existe = rutas.find((x) => fs.existsSync(path.join(x, 'proyectos')));
      if (existe ?? rutas[0]) return existe ?? rutas[0];
    }
  } catch {
    // archivo ausente o inválido: se sigue con el default
  }
  return platform === 'win32' ? path.win32.join('C:', 'MiCarpeta', 'lineamientos-dev-claude-bacg') : path.join(home, 'lineamientos-dev-claude-bacg');
}

// Carpeta del repo con la configuración del proyecto (proyecto.yml, reglas, resumen, canon, adr). Viaja con el
// repo: cualquier clon, cuenta o sesión en la nube la tiene sin una copia local de lineamientos.
export const CARPETA_REPO = '.bacg-dev';

// YAML de un archivo, o null si no existe, no es archivo o no se puede leer.
function yamlDe(archivo) {
  try {
    return fs.statSync(archivo).isFile() ? yaml.load(fs.readFileSync(archivo, 'utf8')) : null;
  } catch {
    return null;
  }
}

// Sube desde cwd hasta encontrar `.bacg-lineamientos` (línea `proyecto: <id>`) o `.bacg-dev/proyecto.yml` (con `id`).
// Sin marcador (PLG-CT): el repo git de cwd cuenta si su remoto origin es <cuenta_github>/<nombre> (o `github:` de
// la entrada) de algún repo de un proyecto registrado en la copia de lineamientos. Así los repos del producto no
// llevan archivos del plugin: alcanza con declararlos en proyectos/<id>/proyecto.yml.
export function buscarRepo(cwd, { dirLin } = {}) {
  let dir = path.resolve(cwd);
  for (;;) {
    const datos = yamlDe(path.join(dir, '.bacg-lineamientos'));
    if (datos && datos.proyecto) return { raiz: dir, proyectoId: String(datos.proyecto) };
    const enRepo = yamlDe(path.join(dir, CARPETA_REPO, 'proyecto.yml'));
    if (enRepo && enRepo.id) return { raiz: dir, proyectoId: String(enRepo.id) };
    const padre = path.dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  return repoPorRemoto(cwd, dirLin ?? dirLineamientos());
}

const cacheToplevel = new Map();
const cacheIndice = new Map();

function toplevel(dir) {
  const d = path.resolve(dir);
  if (cacheToplevel.has(d)) return cacheToplevel.get(d);
  let top = null;
  if (fs.existsSync(d)) {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    top = r.status === 0 && r.stdout.trim() ? path.resolve(r.stdout.trim()) : null;
  }
  cacheToplevel.set(d, top);
  return top;
}

/** "owner/repo" en minúsculas del remoto origin (https, ssh o con proxy /git/owner/repo), o null. */
export function remotoGh(raiz) {
  const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const url = r.status === 0 ? r.stdout.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '') : '';
  const m = url.match(/([^/:]+)\/([^/:]+)$/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** Mapa "owner/repo" -> id de proyecto, de los proyecto.yml de dirLin/proyectos (salvo `_*`). */
export function indiceRemotos(dirLin) {
  if (cacheIndice.has(dirLin)) return cacheIndice.get(dirLin);
  const idx = new Map();
  let entradas = [];
  try {
    entradas = fs.readdirSync(path.join(dirLin, 'proyectos'), { withFileTypes: true });
  } catch {
    // sin copia de lineamientos
  }
  for (const e of entradas) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const py = yamlDe(path.join(dirLin, 'proyectos', e.name, 'proyecto.yml'));
    if (!py || typeof py !== 'object') continue;
    const id = String(py.id ?? e.name);
    const cuenta = typeof py.cuenta_github === 'string' ? py.cuenta_github.trim() : '';
    for (const r of Array.isArray(py.repos) ? py.repos : []) {
      const gh = typeof r?.github === 'string' && r.github.includes('/') ? r.github.trim()
        : cuenta && typeof r?.nombre === 'string' && r.nombre.trim() ? `${cuenta}/${r.nombre.trim()}` : '';
      if (!gh) continue;
      const k = gh.toLowerCase();
      if (!idx.has(k)) idx.set(k, id);
      else if (idx.get(k) !== id) {
        const ya = cacheAmbiguos.get(dirLin) ?? new Map();
        ya.set(k, [...new Set([...(ya.get(k) ?? [idx.get(k)]), id])]);
        cacheAmbiguos.set(dirLin, ya);
      }
    }
  }
  cacheIndice.set(dirLin, idx);
  return idx;
}

// Repos declarados en más de un proyecto: "owner/repo" -> [ids]. La detección por remoto toma el primero y
// `rq.mjs abrir` pide desambiguar con el marcador .bacg-lineamientos.
const cacheAmbiguos = new Map();

function repoPorRemoto(cwd, dirLin) {
  if (!dirLin) return null;
  const idx = indiceRemotos(dirLin);
  if (idx.size === 0) return null;
  const top = toplevel(cwd);
  if (!top) return null;
  const gh = remotoGh(top);
  const id = gh ? idx.get(gh) : undefined;
  if (!id) return null;
  const ambiguos = cacheAmbiguos.get(dirLin)?.get(gh);
  return ambiguos ? { raiz: top, proyectoId: id, porRemoto: true, ambiguos } : { raiz: top, proyectoId: id, porRemoto: true };
}

/** ¿El repo trae su propia configuración en .bacg-dev/? */
export const configEnRepo = (raiz) => Boolean(raiz) && fs.existsSync(path.join(raiz, CARPETA_REPO, 'proyecto.yml'));

/** Carpeta del proyecto: `.bacg-dev/` del repo si existe (manda el repo); si no, `proyectos/<id>` de lineamientos. */
export function carpetaProyecto(id, dirLin, raiz) {
  return configEnRepo(raiz) ? path.join(raiz, CARPETA_REPO) : path.join(dirLin, 'proyectos', id);
}

export function cargarProyecto(id, dir, raiz, { home = os.homedir() } = {}) {
  const archivo = path.join(carpetaProyecto(id, dir, raiz), 'proyecto.yml');
  if (!fs.existsSync(archivo)) throw new Error(`Proyecto ${id} no registrado en ${dir}/proyectos`);
  return conLocal(yaml.load(fs.readFileSync(archivo, 'utf8')), id, home);
}

/**
 * Ajustes de esta PC sobre el proyecto compartido: los tests los corre cada dev en su máquina, con su entorno local.
 * ~/.claude/bacg-dev.json:
 *   { "proyectos": { "powerfy": { "tests": { "unit": "node \"C:/mi/qa/odoo-test.mjs\" {archivos}", "e2e": "...", "e2e_url": "..." } } } }
 * Las claves de `tests` que declara la PC mandan sobre las de proyecto.yml; el resto queda como está.
 */
export function ajustesLocales(id, home = os.homedir()) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'bacg-dev.json'), 'utf8'));
    const p = cfg?.proyectos?.[id];
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

function conLocal(proyecto, id, home) {
  const local = ajustesLocales(id, home);
  if (!local || !proyecto || typeof proyecto !== 'object') return proyecto;
  const tests = local.tests && typeof local.tests === 'object' && !Array.isArray(local.tests) ? local.tests : null;
  return tests ? { ...proyecto, tests: { ...(proyecto.tests ?? {}), ...tests }, tests_locales: Object.keys(tests) } : proyecto;
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
