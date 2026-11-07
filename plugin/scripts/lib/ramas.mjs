// Rama de trabajo del RQ (M7 del handoff ciclo-rq/UI): un proyecto que declara ramas_solo_pr o ramas_prod no
// recibe commits de RQ directo en esas ramas. Cada RQ trabaja en rq/<código> y llega por PR.

import { spawnSync } from 'node:child_process';
import { nombreRepo } from './config.mjs';
import { ramasProd, ramasSoloPr } from './stack.mjs';

const lista = (x) => (Array.isArray(x) ? x : []);

function git(raiz, args) {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8' });
  return { ok: r.status === 0, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim() };
}

/** Entrada del repo en proyecto.repos (por el nombre de su remoto), o undefined. */
export function entradaDelRepo(proyecto, raiz) {
  const nombre = nombreRepo(raiz).toLowerCase();
  return lista(proyecto?.repos).find((r) => typeof r?.nombre === 'string' && r.nombre.toLowerCase() === nombre);
}

/** Rama actual (null en detached HEAD o sin commits). */
export function ramaActual(raiz) {
  const r = git(raiz, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return r.ok && r.out ? r.out : null;
}

/** Ramas que no reciben commits de un RQ: ramas_solo_pr y ramas_prod del repo (o del proyecto). */
export function ramasProtegidas(proyecto, raiz) {
  const entrada = entradaDelRepo(proyecto, raiz);
  return [...new Set([...ramasSoloPr(proyecto, entrada), ...(ramasProd(proyecto, entrada) ?? [])].filter(Boolean))];
}

/** La rama actual si es una protegida (ramas_solo_pr o ramas_prod), o null. */
export function enRamaProtegida(raiz, proyecto) {
  const rama = ramaActual(raiz);
  return rama && ramasProtegidas(proyecto, raiz).includes(rama) ? rama : null;
}

export const ramaDelRq = (codigo) => `rq/${codigo}`;

/**
 * Pasa a rq/<código>: si ya existe, la toma; si no, la crea desde el upstream de la rama protegida cuando HEAD sólo
 * está atrás (o igual), y desde HEAD cuando tiene commits propios (para no perderlos). Los cambios sin commitear
 * viajan con el switch (git los deja si no chocan). Devuelve { rama, desde, creada } o { error }.
 */
export function pasarARamaDelRq(raiz, codigo) {
  const rama = ramaDelRq(codigo);
  if (git(raiz, ['rev-parse', '--verify', '-q', `refs/heads/${rama}`]).ok) {
    const s = git(raiz, ['switch', '-q', rama]);
    return s.ok ? { rama, desde: rama, creada: false } : { error: s.err || `git switch ${rama} falló` };
  }
  const up = git(raiz, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const soloAtras = up.ok && up.out && git(raiz, ['merge-base', '--is-ancestor', 'HEAD', up.out]).ok;
  const desde = soloAtras ? up.out : 'HEAD';
  const s = git(raiz, ['switch', '-q', '-c', rama, '--no-track', desde]);
  return s.ok ? { rama, desde, creada: true } : { error: s.err || `git switch -c ${rama} falló` };
}
