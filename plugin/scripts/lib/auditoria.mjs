// Auditoría de commits de agentes sin el plugin (Lovable u otros de agentes_externos): lo que llega a la rama sin
// pasar por las compuertas.
// La marca `docs/log/auditoria-lovable.yml` guarda hasta qué commit se revisó; `rq.mjs auditar` lista lo posterior
// y `rq.mjs auditar --cerrar "<nota>"` mueve la marca y deja la revisión en docs/log/rq.jsonl.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from '../vendor/js-yaml.mjs';
import { globARegExp, tipoArchivo } from './rutas.mjs';
import { AUTORES_LOVABLE, autoresExternos, esMigracion } from './stack.mjs';

export const AUTORES = AUTORES_LOVABLE;
export const RUTA_MARCA = path.join('docs', 'log', 'auditoria-lovable.yml');
const DIAS_SIN_MARCA = 30;

const lista = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim() !== '') : []);

/** Autores que se auditan: agentes_externos.autores o lovable.autores del proyecto, o los de Lovable por defecto. */
export const autoresAuditados = autoresExternos;

/** Cómo se nombra a esos agentes en los avisos. */
const nombreAgentes = (proyecto) => {
  const n = proyecto?.agentes_externos?.nombre;
  if (typeof n === 'string' && n.trim()) return n.trim();
  return lista(proyecto?.agentes_externos?.autores).length ? 'agentes externos' : 'Lovable';
};

// Tests: los de JS/TS (*.test.*, *.spec.*), carpetas test/ o tests/ (Odoo, Python) y test_*.py.
const RE_TEST = /\.(test|spec)\.[jt]sx?$|(?:^|\/)tests?\/|(?:^|\/)test_[^/]*\.py$/;

export function leerMarca(raiz) {
  try {
    const m = yaml.load(fs.readFileSync(path.join(raiz, RUTA_MARCA), 'utf8'));
    return m && typeof m.revisado_hasta === 'string' ? m : null;
  } catch {
    return null;
  }
}

function git(raiz, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Commits de los autores auditados posteriores a la marca (o de los últimos 30 días sin marca), del más nuevo al
 * más viejo: [{ hash, autor, fecha, asunto, archivos, migraciones, sensible, sinTests }]. null si git falla.
 */
export function commitsAuditables(raiz, proyecto, { ref = 'HEAD' } = {}) {
  const marca = leerMarca(raiz);
  const rango = marca ? [`${marca.revisado_hasta}..${ref}`] : [`--since=${DIAS_SIN_MARCA}.days`, ref];
  // -F: el nombre es texto literal ("[bot]" no es una clase de caracteres); " <" lo ancla al final del nombre.
  const autores = autoresAuditados(proyecto).map((a) => `--author=${a} <`);
  const out = git(raiz, ['log', '-F', '--format=@@%H%x09%an%x09%cs%x09%s', '--name-only', ...autores, ...rango]);
  if (out === null) return null;
  const sensibles = lista(proyecto?.sensible?.rutas).map(globARegExp);
  const commits = [];
  for (const bloque of out.split('@@').slice(1)) {
    const [cabecera, ...resto] = bloque.split('\n');
    const [hash, autor, fecha, ...asunto] = cabecera.split('\t');
    const archivos = resto.map((l) => l.trim()).filter(Boolean);
    // Código: lo que no es libre (docs, tests) ni migración, dentro de una carpeta (sin la config suelta de la raíz).
    const codigo = archivos.filter((a) => a.includes('/') && tipoArchivo(a, proyecto) !== 'libre' && !esMigracion(a, proyecto) && !RE_TEST.test(a));
    commits.push({
      hash,
      autor,
      fecha,
      asunto: asunto.join('\t'),
      archivos,
      migraciones: archivos.some((a) => esMigracion(a, proyecto)),
      sensible: archivos.some((a) => sensibles.some((re) => re.test(a))),
      sinTests: codigo.length > 0 && !archivos.some((a) => RE_TEST.test(a) || a.startsWith('e2e/')),
    });
  }
  return { marca, commits };
}

/** Línea corta para el arranque de sesión, o null si no hay nada que auditar. */
export function avisoAuditoria(raiz, proyecto) {
  const r = commitsAuditables(raiz, proyecto);
  if (!r || r.commits.length === 0) return null;
  const n = r.commits.length;
  const mig = r.commits.filter((c) => c.migraciones).length;
  const desde = r.marca ? `desde la última auditoría (${r.marca.revisado_hasta.slice(0, 9)})` : `en los últimos ${DIAS_SIN_MARCA} días (auditoría sin iniciar)`;
  return `Auditoría: ${n} commit(s) de ${nombreAgentes(proyecto)} sin revisar ${desde}${mig ? `, ${mig} con migraciones` : ''}. Revisalos con rq.mjs auditar y regularizá lo que haga falta como RQ o BUG.`;
}

/** Mueve la marca a `hasta` y devuelve la línea que va a docs/log/rq.jsonl. */
export function cerrarAuditoria(raiz, { hasta, nota, commits, fecha }) {
  const archivo = path.join(raiz, RUTA_MARCA);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, yaml.dump({ revisado_hasta: hasta, fecha, nota }, { lineWidth: 120 }));
  return {
    fecha,
    tipo: 'auditoria-lovable',
    hasta,
    commits: commits.length,
    migraciones: commits.filter((c) => c.migraciones).length,
    sensible: commits.filter((c) => c.sensible).length,
    sin_tests: commits.filter((c) => c.sinTests).length,
    nota,
  };
}
