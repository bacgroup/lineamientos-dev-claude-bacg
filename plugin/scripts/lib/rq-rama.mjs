// A qué RQ pertenece el trabajo de ahora, según la rama (handoff 4.0.1, punto 4). Un RQ con su PR mergeado seguía en
// ACTIVO y el hook le anotaba skills de sesiones posteriores que eran de otro RQ.

import { spawnSync } from 'node:child_process';
import { rqsActivos, cargarEstado } from './estado.mjs';
import { ramaActual, ramaDelRq } from './ramas.mjs';

function git(raiz, args) {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? String(r.stdout ?? '').trim() : null;
}

/** Commit de la rama del RQ (local o, si no está, la de origin), o null si no existe. */
function puntaDe(raiz, rama) {
  return git(raiz, ['rev-parse', '--verify', '-q', `refs/heads/${rama}^{commit}`])
    ?? git(raiz, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${rama}^{commit}`]);
}

const baseDe = (raiz, codigo) => {
  try {
    return cargarEstado(raiz, codigo).base ?? null;
  } catch {
    return null;
  }
};

/**
 * ¿La rama rq/<código> ya entró en otra rama de origin (merge del PR)? { rama, en } o null. Sólo cuenta si la rama
 * tiene commits propios desde la base del RQ: una rama recién creada también está "contenida" en la de DEV. Un
 * squash merge no se ve acá (sólo con gh).
 */
export function ramaMergeada(raiz, codigo, base = baseDe(raiz, codigo)) {
  const rama = ramaDelRq(codigo);
  const punta = puntaDe(raiz, rama);
  if (!punta) return null;
  if (base) {
    const propios = Number(git(raiz, ['rev-list', '--count', `${base}..${punta}`]) ?? 0);
    if (propios === 0) return null;
  }
  const otras = (git(raiz, ['branch', '-r', '--contains', punta, '--format=%(refname:short)']) ?? '')
    .split('\n').map((s) => s.trim())
    .filter((r) => r && r !== `origin/${rama}` && !/\/HEAD$/.test(r) && r !== 'origin' && !r.startsWith('origin/rq/'));
  return otras.length ? { rama, en: otras[0] } : null;
}

/**
 * RQ al que se anota lo que pasa ahora (skills): el de la rama actual si es rq/<código> activo; si no, el último de
 * ACTIVO, salvo que ese RQ tenga su rama y no estemos en ella (el trabajo es de otra cosa). Un RQ cuya rama ya está
 * mergeada no recibe nada: null (hay que preguntar a qué RQ va).
 */
export function rqParaRegistrar(raiz) {
  const activos = rqsActivos(raiz);
  if (activos.length === 0) return null;
  const actual = ramaActual(raiz);
  const deRama = /^rq\/(.+)$/.exec(actual ?? '')?.[1];
  let codigo;
  if (deRama && activos.includes(deRama)) codigo = deRama;
  else {
    const ultimo = activos[activos.length - 1];
    if (puntaDe(raiz, ramaDelRq(ultimo)) && actual !== ramaDelRq(ultimo)) return null;
    codigo = ultimo;
  }
  return ramaMergeada(raiz, codigo) ? null : codigo;
}

/** PR mergeado de rq/<código> según gh: { numero, base, fecha } o null (sin gh, sin PR o error). */
export function prMergeadoGh(raiz, codigo, env = process.env) {
  if (env.BACG_DEV_SIN_GH === '1') return null;
  try {
    const r = spawnSync('gh', ['pr', 'list', '--head', ramaDelRq(codigo), '--state', 'merged', '--json', 'number,baseRefName,mergedAt', '-L', '1'], {
      cwd: raiz, encoding: 'utf8', timeout: 20000, env, stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.status !== 0) return null;
    const [pr] = JSON.parse(r.stdout || '[]');
    return pr ? { numero: pr.number, base: pr.baseRefName, fecha: pr.mergedAt } : null;
  } catch {
    return null;
  }
}

/** Aviso de RQ abierto con el PR ya mergeado, o null. */
export function avisoMergeado(raiz, codigo, env = process.env) {
  const local = ramaMergeada(raiz, codigo);
  const gh = local ? null : prMergeadoGh(raiz, codigo, env);
  if (!local && !gh) return null;
  const donde = local ? `La rama ${local.rama} ya está mergeada en ${local.en}` : `El PR #${gh.numero} de ${ramaDelRq(codigo)} ya está mergeado en ${gh.base}${gh.fecha ? ` (${gh.fecha.slice(0, 10)})` : ''}`;
  return `${donde} y el RQ ${codigo} sigue abierto: si falta el despliegue, seguí con la etapa 5 ($RQ entregar / $RQ paso hecho …); si ya está, cerralo con $RQ cerrar.${local ? ' Hasta entonces el hook no le anota skills.' : ''}`;
}
