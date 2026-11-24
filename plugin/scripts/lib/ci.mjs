// PLG-CI-MIN: que el ciclo no queme minutos de CI. Los commits de sólo docs de la CLI llevan [skip ci] (salvo
// ci.skip_docs: false en proyecto.yml) y el arranque avisa los workflows que corren con cada commit de docs.
// Guía para el proyecto: plugin/general/ci.md.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from '../vendor/js-yaml.mjs';

const lista = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : typeof x === 'string' ? [x] : []);

/** ¿Los commits de sólo docs llevan [skip ci]? Por defecto sí; `ci.skip_docs: false` lo apaga (p. ej. checks obligatorios). */
export const saltarCi = (proyecto) => proyecto?.ci?.skip_docs !== false;

/** ¿Son todas rutas de documentación (docs/** o *.md)? Tests, código y .bacg-dev/ no: los lee el CI. */
export const soloDocs = (rutas) => rutas.length > 0 && rutas.every((r) => /^docs\//.test(r) || /\.md$/i.test(r));

/** Agrega " [skip ci]" a la primera línea del mensaje, una sola vez. */
export function conSkipCi(mensaje) {
  const [primera, ...resto] = String(mensaje).split('\n');
  if (/\[skip ci\]/i.test(primera)) return mensaje;
  return [`${primera} [skip ci]`, ...resto].join('\n');
}

const EVENTOS = ['push', 'pull_request', 'pull_request_target'];
const excluyeDocs = (f) => lista(f['paths-ignore']).some((p) => /^docs\//.test(p))
  || lista(f.paths).some((p) => /^!docs\//.test(p))
  || (lista(f.paths).length > 0 && !lista(f.paths).some((p) => p === '**' || p === '**/*' || /^docs\//.test(p)));
const excluyeConfig = (f) => lista(f['paths-ignore']).some((p) => /^\.bacg-dev\b/.test(p)) || lista(f.paths).some((p) => /^!\.bacg-dev\b/.test(p));

/** Eventos del workflow que corren con un push o un PR, con su configuración ({} si no tiene). */
function eventosDe(doc) {
  const on = doc?.on ?? doc?.[true];
  if (typeof on === 'string') return EVENTOS.includes(on) ? [[on, {}]] : [];
  if (Array.isArray(on)) return on.filter((e) => EVENTOS.includes(e)).map((e) => [e, {}]);
  if (on && typeof on === 'object') return Object.entries(on).filter(([e]) => EVENTOS.includes(e)).map(([e, c]) => [e, c && typeof c === 'object' ? c : {}]);
  return [];
}

// Un test que lee un archivo de docs/: readFileSync('docs/…'), import '…docs/…?raw', import.meta.glob('…docs/…').
const RE_LEE_DOCS = /(?:readFileSync|readFile)\(\s*['"`][^'"`]*\bdocs\/|['"`][^'"`]*\bdocs\/[^'"`]*\?raw['"`]|import\.meta\.glob\(\s*['"`][^'"`]*\bdocs\//;
const RE_TEST = /(^|\/)(tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

function testsQueLeenDocs(raiz) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8' });
  if (r.status !== 0) return [];
  const out = [];
  for (const f of r.stdout.split('\0').filter((x) => RE_TEST.test(x) && !x.startsWith('docs/')).slice(0, 3000)) {
    try {
      const abs = path.join(raiz, f);
      if (fs.statSync(abs).size > 512 * 1024) continue;
      if (RE_LEE_DOCS.test(fs.readFileSync(abs, 'utf8'))) out.push(f);
    } catch {
      // un archivo que no se puede leer no cambia el aviso
    }
  }
  return out;
}

/** Avisos del arranque sobre los workflows de GitHub Actions del repo ([] si no hay nada que decir). */
export function avisosCi(raiz) {
  const dir = path.join(raiz, '.github', 'workflows');
  let archivos;
  try {
    archivos = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  } catch {
    return [];
  }
  const avisos = [];
  let algunoExcluyeDocs = false;
  for (const f of archivos) {
    const rel = `.github/workflows/${f}`;
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const eventos = eventosDe(doc);
    if (eventos.length === 0) continue;
    const nombre = typeof doc?.name === 'string' && doc.name ? doc.name : f;
    if (eventos.some(([, c]) => !excluyeDocs(c))) {
      avisos.push(`Aviso: cada commit de docs del ciclo corre el workflow ${nombre} (${rel}): sumale un filtro de docs (paths o paths-ignore; ver general/ci.md del plugin) o dejá que los commits de docs lleven [skip ci].`);
    } else {
      algunoExcluyeDocs = true;
    }
    if (eventos.some(([, c]) => excluyeConfig(c))) {
      avisos.push(`Aviso: el workflow ${nombre} (${rel}) deja afuera .bacg-dev/: ahí están tests.rojos_conocidos y los comandos de tests; sacalo del filtro.`);
    }
  }
  if (algunoExcluyeDocs) {
    const leen = testsQueLeenDocs(raiz);
    if (leen.length) {
      avisos.push(`Aviso: ${leen.slice(0, 5).join(', ')}${leen.length > 5 ? ` y ${leen.length - 5} más` : ''} lee docs/ y el CI deja afuera docs/: re-incluí esas rutas en el filtro (paths: '**', '!docs/**' y después la ruta).`);
    }
  }
  return avisos;
}
