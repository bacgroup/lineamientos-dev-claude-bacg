// PLG-DFF (pedido 3 de dev-fullflow): proyectos con la configuración en su repo (.bacg-dev/proyecto.yml) que están en esta PC.
// Las compuertas de MCP los usan para reconocer un project_id de PROD (Supabase, Lovable) aunque la sesión no esté
// dentro del repo: desde la carpeta que agrupa los clones o desde otro repo. Se buscan:
//   - debajo de la carpeta de trabajo, hasta dos niveles (sin node_modules ni carpetas ocultas);
//   - en ~/.claude/bacg-dev.json: { "proyectos": { "<id>": { "raiz": "<ruta del repo>" | ["<ruta>", …] } } }.
// Un proyecto.yml que no se puede leer se ignora: no es de esta sesión y no tiene que frenar a las demás.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from '../vendor/js-yaml.mjs';

const CARPETA = '.bacg-dev';
const NIVELES = 2;
const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

function leerProyecto(raiz) {
  try {
    const py = yaml.load(fs.readFileSync(path.join(raiz, CARPETA, 'proyecto.yml'), 'utf8'));
    return esObjeto(py) && typeof py.id === 'string' && py.id.trim() ? py : null;
  } catch {
    return null;
  }
}

function debajo(dir, niveles) {
  const out = [];
  if (fs.existsSync(path.join(dir, CARPETA, 'proyecto.yml'))) out.push(dir);
  if (niveles === 0) return out;
  let entradas = [];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entradas) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    out.push(...debajo(path.join(dir, e.name), niveles - 1));
  }
  return out;
}

function desdeAjustes(home) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'bacg-dev.json'), 'utf8'));
    const out = [];
    for (const p of Object.values(esObjeto(cfg?.proyectos) ? cfg.proyectos : {})) {
      const r = p?.raiz;
      for (const x of Array.isArray(r) ? r : [r]) if (typeof x === 'string' && x.trim()) out.push(x.trim());
    }
    return out;
  } catch {
    return [];
  }
}

/** Proyectos locales: [{ id, proyecto, raiz }], sin repetir repo. ajustes: false omite bacg-dev.json (sólo lo de debajo de cwd). */
export function proyectosLocales({ cwd = null, home = os.homedir(), ajustes = true } = {}) {
  const raices = [...(ajustes ? desdeAjustes(home) : []), ...(cwd ? debajo(path.resolve(cwd), NIVELES) : [])];
  const vistos = new Set();
  const out = [];
  for (const r of raices) {
    const clave = process.platform === 'win32' ? path.resolve(r).toLowerCase() : path.resolve(r);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const proyecto = leerProyecto(r);
    if (proyecto) out.push({ id: String(proyecto.id), proyecto, raiz: path.resolve(r) });
  }
  return out;
}
