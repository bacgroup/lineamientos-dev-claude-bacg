// Skills oficiales de Odoo (PLG-ODOO): odoo/odoo, carpeta skills/ de la rama 20.0 (la única que las trae).
// Se instalan juntas (se referencian entre sí) en ~/.claude/skills/ con `rq.mjs odoo-skills`; no se copian a este
// repo. En un proyecto Odoo (datos.motor odoo, o sin motor declarado con addons en el repo; salvo `odoo_skills: false` en proyecto.yml) la CLI las exige según
// lo que toca el RQ dentro de un addon (carpeta con __manifest__.py):
//   - etapa 2 (desarrollo): odoo-guidelines (Python, XML, datos, seguridad) y odoo-web-guidelines (static/);
//   - etapa 3 (verificación): odoo-review y, si toca rutas sensibles o controllers/, odoo-security.
// odoo-git no se exige: sus convenciones de commits y ramas son las de odoo/odoo; en BACG mandan las del proyecto.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { globARegExp } from './rutas.mjs';
import { ETAPA } from './etapas.mjs';

const { DESARROLLO, VERIFICACION } = ETAPA;

export const REPO_ODOO = 'odoo/odoo';
export const RAMA_SKILLS_ODOO = '20.0';
export const SKILLS_ODOO = ['odoo-git', 'odoo-guidelines', 'odoo-review', 'odoo-security', 'odoo-web-guidelines'];
export const ARCHIVO_ORIGEN = '.odoo-skills.json';
const lista = (x) => (Array.isArray(x) ? x : []);

export const dirSkills = (home = os.homedir()) => path.join(home, '.claude', 'skills');

const cacheManifiesto = new Map();

/** Vacía la caché de hayManifiestoOdoo (para tests; en producción vive lo que el proceso). */
export const limpiarCacheOdoo = () => cacheManifiesto.clear();

/** ¿Hay algún __manifest__.py hasta 3 niveles de carpetas bajo `raiz` (sin node_modules ni .git)? Cacheado por raíz. */
export function hayManifiestoOdoo(raiz) {
  if (!raiz) return false;
  const clave = path.resolve(String(raiz));
  if (cacheManifiesto.has(clave)) return cacheManifiesto.get(clave);
  const buscar = (dir, nivel) => {
    if (fs.existsSync(path.join(dir, '__manifest__.py'))) return true;
    if (nivel >= 3) return false;
    let hijos = [];
    try {
      hijos = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    return hijos.some((e) => e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git' && buscar(path.join(dir, e.name), nivel + 1));
  };
  const hay = buscar(clave, 0);
  cacheManifiesto.set(clave, hay);
  return hay;
}

/**
 * ¿El proyecto trabaja con Odoo? `odoo_skills: false` lo apaga; `datos.motor` declarado manda (odoo o no);
 * sin declarar, sí si el repo (`raiz`) tiene addons. Sin raíz y sin motor declarado: no.
 */
export function usaOdoo(proyecto, raiz) {
  if (proyecto?.odoo_skills === false) return false;
  const declarado = typeof proyecto?.datos?.motor === 'string' ? proyecto.datos.motor.trim().toLowerCase() : '';
  if (declarado) return declarado === 'odoo';
  return hayManifiestoOdoo(raiz);
}

/** Rama de odoo/odoo de donde se toman: `odoo_skills.rama` del proyecto o 20.0. */
export const ramaSkills = (proyecto) =>
  typeof proyecto?.odoo_skills?.rama === 'string' && proyecto.odoo_skills.rama.trim() ? proyecto.odoo_skills.rama.trim() : RAMA_SKILLS_ODOO;

/** Estado de la instalación: { faltan: [...], origen: { rama, commit, fecha } | null }. */
export function estadoSkillsOdoo(home = os.homedir()) {
  const dir = dirSkills(home);
  const faltan = SKILLS_ODOO.filter((s) => !fs.existsSync(path.join(dir, s, 'SKILL.md')));
  let origen = null;
  try {
    origen = JSON.parse(fs.readFileSync(path.join(dir, ARCHIVO_ORIGEN), 'utf8'));
  } catch {
    // sin registro de origen (instalación a mano o ninguna)
  }
  return { faltan, origen };
}

function ghApi(ruta) {
  const r = spawnSync('gh', ['api', ruta], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`gh api ${ruta}: ${(r.stderr ?? '').trim().split('\n')[0] || `salió ${r.status}`}`);
  return JSON.parse(r.stdout);
}

/**
 * Baja skills/ de odoo/odoo (rama `rama`) y deja cada skill en ~/.claude/skills/<skill>, reemplazando sólo las de
 * SKILLS_ODOO. `api` (para tests) recibe la ruta de la API de GitHub y devuelve el JSON.
 * Devuelve { rama, commit, archivos }.
 */
export function instalarSkillsOdoo({ home = os.homedir(), rama = RAMA_SKILLS_ODOO, api = ghApi } = {}) {
  const ref = encodeURIComponent(rama);
  const commit = api(`repos/${REPO_ODOO}/commits/${ref}`)?.sha ?? null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'odoo-skills-'));
  let archivos = 0;
  const bajar = (rel) => {
    for (const e of lista(api(`repos/${REPO_ODOO}/contents/${rel}?ref=${commit ?? ref}`))) {
      if (e.type === 'dir') bajar(e.path);
      else if (e.type === 'file') {
        const f = api(`repos/${REPO_ODOO}/contents/${e.path}?ref=${commit ?? ref}`);
        const destino = path.join(tmp, path.relative('skills', e.path));
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, Buffer.from(String(f.content ?? ''), f.encoding === 'base64' ? 'base64' : 'utf8'));
        archivos++;
      }
    }
  };
  try {
    bajar('skills');
    const faltan = SKILLS_ODOO.filter((s) => !fs.existsSync(path.join(tmp, s, 'SKILL.md')));
    if (faltan.length) throw new Error(`${REPO_ODOO}@${rama} no trae ${faltan.join(', ')} en skills/`);
    const dir = dirSkills(home);
    fs.mkdirSync(dir, { recursive: true });
    for (const s of SKILLS_ODOO) {
      fs.rmSync(path.join(dir, s), { recursive: true, force: true });
      fs.cpSync(path.join(tmp, s), path.join(dir, s), { recursive: true });
    }
    fs.writeFileSync(path.join(dir, ARCHIVO_ORIGEN), `${JSON.stringify({ repo: REPO_ODOO, rama, commit, fecha: new Date().toISOString(), skills: SKILLS_ODOO }, null, 2)}\n`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { rama, commit, archivos };
}

/** ¿La ruta (relativa a raiz, POSIX) está dentro de un addon de Odoo? Devuelve la ruta dentro del addon o null. */
export function dentroDeAddon(raiz, rel, cache = new Map()) {
  const partes = String(rel).replace(/\\/g, '/').split('/');
  for (let i = partes.length - 1; i >= 1; i--) {
    const dir = partes.slice(0, i).join('/');
    if (!cache.has(dir)) cache.set(dir, fs.existsSync(path.join(raiz, dir, '__manifest__.py')));
    if (cache.get(dir)) return partes.slice(i).join('/');
  }
  return null;
}

/** ¿El repo tiene algún addon? (__manifest__.py hasta 3 niveles abajo de la raíz) */
export const tieneAddons = hayManifiestoOdoo;

/**
 * Skills de Odoo que exige el RQ: [{ etapa, skill }]. `rutasRq` null (no se sabe qué toca) en un repo con addons
 * exige odoo-guidelines y odoo-review: falla cerrada, como skills_requeridas.
 */
export function exigenciasOdoo(proyecto, raiz, rutasRq) {
  if (!usaOdoo(proyecto, raiz)) return [];
  if (!rutasRq) return tieneAddons(raiz) ? [{ etapa: DESARROLLO, skill: 'odoo-guidelines' }, { etapa: VERIFICACION, skill: 'odoo-review' }] : [];
  const sensibles = [...lista(proyecto?.sensible?.rutas), '**/controllers/**'].filter((g) => typeof g === 'string').map(globARegExp);
  const cache = new Map();
  let py = false;
  let web = false;
  let seg = false;
  for (const r of rutasRq) {
    const enAddon = raiz ? dentroDeAddon(raiz, r, cache) : null;
    if (enAddon === null) continue;
    if (/^static\//.test(enAddon)) web = true;
    else py = true;
    if (sensibles.some((re) => re.test(r))) seg = true;
  }
  const out = [];
  if (py) out.push({ etapa: DESARROLLO, skill: 'odoo-guidelines' });
  if (web) out.push({ etapa: DESARROLLO, skill: 'odoo-web-guidelines' });
  if (py || web) out.push({ etapa: VERIFICACION, skill: 'odoo-review' });
  if (seg) out.push({ etapa: VERIFICACION, skill: 'odoo-security' });
  return out;
}
