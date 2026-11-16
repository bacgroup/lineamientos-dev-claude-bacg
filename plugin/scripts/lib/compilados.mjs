// Artefactos compilados compartidos entre RQ (PLG-CLOUD, hallazgo 18). Un bundle o un minificado que dos ramas rq/*
// regeneran en paralelo choca al mergear: el segundo PR tiene que recompilar después del primero. `entregar` avisa si
// otra rama rq/* de origin toca alguno de los compilados que toca este RQ. `compilados` en proyecto.yml declara los
// globs; sin la clave, *.bundle.js, *.min.js y dist/**.
import { spawnSync } from 'node:child_process';
import { globARegExp } from './rutas.mjs';
import { rutasDelRq } from './circuito.mjs';

export const COMPILADOS_POR_DEFECTO = ['**/*.bundle.js', '**/*.min.js', '**/dist/**'];

function git(raiz, args) {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Globs de compilados del proyecto. */
export function globsCompilados(proyecto) {
  const l = Array.isArray(proyecto?.compilados) ? proyecto.compilados.filter((g) => typeof g === 'string' && g.trim()) : null;
  return l && l.length ? l : COMPILADOS_POR_DEFECTO;
}

/** Avisos (textos) por cada otra rama origin/rq/* que toca los mismos compilados que el RQ. [] si no hay. */
export function compiladosCompartidos(raiz, estado, proyecto, ramaPropia) {
  const res = globsCompilados(proyecto).map(globARegExp);
  const esCompilado = (r) => res.some((re) => re.test(r));
  const mios = (rutasDelRq(raiz, estado) ?? []).filter(esCompilado);
  if (!mios.length) return [];
  // Las ramas rq/* de origin, traídas ahora (en la nube el clon trae sólo la rama por defecto).
  const traidas = git(raiz, ['fetch', '--quiet', '--prune', 'origin', '+refs/heads/rq/*:refs/remotes/origin/rq/*']) !== null;
  const lista = git(raiz, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/rq/']);
  const avisos = [];
  if (!traidas || lista === null) avisos.push(`Compilados: no verifiqué si otra rama rq/* toca ${mios.join(', ')} (no pude traer o leer las ramas de origin).`);
  const ramas = (lista ?? '').split('\n').filter(Boolean).filter((r) => r !== `origin/${ramaPropia}`);
  for (const ref of ramas) {
    const base = git(raiz, ['merge-base', 'HEAD', ref]);
    if (!base) continue;
    const suyos = new Set((git(raiz, ['diff', '--name-only', `${base}..${ref}`]) ?? '').split('\n').filter(Boolean));
    const ambos = mios.filter((r) => suyos.has(r));
    if (ambos.length) {
      avisos.push(`Compilado compartido: ${ref.replace(/^origin\//, '')} también toca ${ambos.join(', ')}. Mergeá de a uno y recompilá el segundo después de mergear el primero (rebase + build).`);
    }
  }
  return avisos;
}
