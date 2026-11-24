// PLG-CI-MIN: que el ciclo no queme minutos de CI. Los commits de sólo docs de la CLI llevan [skip ci] (salvo
// ci.skip_docs: false en proyecto.yml) y el arranque avisa los workflows que corren con cada commit de docs.
// Guía para el proyecto: plugin/general/ci.md.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from '../vendor/js-yaml.mjs';
import { globARegExp } from './rutas.mjs';

const lista = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : typeof x === 'string' ? [x] : []);

/** ¿Los commits de sólo docs llevan [skip ci]? Por defecto sí; `ci.skip_docs: false` lo apaga (p. ej. checks obligatorios). */
export const saltarCi = (proyecto) => proyecto?.ci?.skip_docs !== false;

// Docs que ningún CI necesita: texto, registros y capturas en docs/, y los .md de la raíz (README, CHANGELOG). Un SQL o
// un script en docs/ lo puede leer la suite; un .md de .bacg-dev/ o de una skill es parte del producto.
const RE_DOC = /^docs\/.+\.(md|ya?ml|jsonl|txt|png|jpe?g|gif|svg|webp|html|csv)$/i;
const RE_MD_RAIZ = /^[^/]+\.md$/i;

/** ¿Son todas rutas de documentación que el CI no lee? Tests, código, .bacg-dev/ y SQL en docs/ no. */
export const soloDocs = (rutas) => rutas.length > 0 && rutas.every((r) => RE_DOC.test(r) || RE_MD_RAIZ.test(r) || r === 'docs/rq/ACTIVO');

/**
 * Ramas de destino del remoto (origin/<rama>) que existen en este clon: la de DEV, las de PROD y la por defecto del
 * remoto (origin/HEAD). Son las que miran el CI de un PR y el de una promoción.
 */
function destinos(raiz, proyecto) {
  const ramas = [proyecto?.rama_dev, proyecto?.entornos?.dev?.rama, ...lista(proyecto?.ramas_solo_pr), ...lista(proyecto?.ramas_prod)]
    .filter((r) => typeof r === 'string' && r.trim());
  const porDefecto = spawnSync('git', ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], { cwd: raiz, encoding: 'utf8' });
  const refs = [...new Set([...ramas.map((r) => `origin/${r.trim()}`), ...(porDefecto.status === 0 ? [porDefecto.stdout.trim()] : [])])];
  return refs.filter((ref) => spawnSync('git', ['rev-parse', '-q', '--verify', `${ref}^{commit}`], { cwd: raiz }).status === 0);
}

/**
 * ¿Todo lo que HEAD trae respecto de cada rama de destino (y de su upstream) es de docs? GitHub decide [skip ci] mirando
 * sólo el commit de punta del push o del PR: si en ese PR o push viaja código, la marca le sacaría el CI. Sin ninguna
 * rama de destino que se pueda resolver, false.
 */
export function pendientesSoloDocs(raiz, proyecto = null) {
  const refs = destinos(raiz, proyecto);
  if (refs.length === 0) return false;
  const conUpstream = spawnSync('git', ['rev-parse', '-q', '--verify', '@{u}'], { cwd: raiz }).status === 0;
  const rutas = [];
  for (const base of [...refs, ...(conUpstream ? ['@{u}'] : [])]) {
    const r = spawnSync('git', ['log', '--name-only', '--format=', `${base}..HEAD`], { cwd: raiz, encoding: 'utf8' });
    if (r.status !== 0) return false;
    rutas.push(...r.stdout.split('\n').filter(Boolean));
  }
  return rutas.length === 0 || soloDocs(rutas);
}

/** ¿El commit que se va a hacer con estas rutas lleva [skip ci]? */
export const conSkipParaCommit = (raiz, proyecto, rutas) => saltarCi(proyecto) && soloDocs(rutas) && pendientesSoloDocs(raiz, proyecto);

/** Agrega " [skip ci]" a la primera línea del mensaje, una sola vez. */
export function conSkipCi(mensaje) {
  const [primera, ...resto] = String(mensaje).split('\n');
  if (/\[skip ci\]/i.test(primera)) return mensaje;
  return [`${primera} [skip ci]`, ...resto].join('\n');
}

const EVENTOS = ['push', 'pull_request', 'pull_request_target'];
/**
 * ¿El filtro del evento deja afuera la ruta? Como GitHub: con `paths-ignore`, si algún patrón coincide; con `paths`, se
 * recorren los patrones en orden y gana el último que coincide (`!` excluye). Sin filtro, no deja afuera nada.
 */
function dejaAfuera(f, ruta) {
  const ignora = lista(f['paths-ignore']);
  if (ignora.length) return ignora.some((p) => globARegExp(p).test(ruta));
  const paths = lista(f.paths);
  if (!paths.length) return false;
  let entra = false;
  for (const p of paths) {
    const neg = p.startsWith('!');
    if (globARegExp(neg ? p.slice(1) : p).test(ruta)) entra = !neg;
  }
  return !entra;
}
const excluyeDocs = (f) => dejaAfuera(f, 'docs/rq/R-1/estado.yml') && dejaAfuera(f, 'docs/backlog.md');
const excluyeConfig = (f) => dejaAfuera(f, '.bacg-dev/proyecto.yml');

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
