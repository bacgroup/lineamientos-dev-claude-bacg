// Pasos de circuito_prod que un RQ puede marcar como "no aplica" (un FIX sin SQL, un cambio sin estándares)
// y las rutas que lo impiden: un sql:<ref> no aplica si el RQ trae migraciones (`datos.migraciones` del
// proyecto; por defecto, supabase/migrations/), y sync-lineamientos no aplica si trae estándares. push: y
// merge-prs-sync: nunca se marcan.
//
// Lo que trae el RQ se mide desde una base fija (estado.base: HEAD al abrir el RQ o, en un RQ abierto
// antes de que existiera, el merge-base con el upstream al marcar el primer paso). Contra el upstream no
// alcanza: después del push el upstream ya tiene los commits y el diff queda vacío.

import { spawnSync } from 'node:child_process';
import { esMigracion } from './stack.mjs';

const RE_ESTANDAR = /^(?:docs\/estandares\/|AGENTS\.md$)/;

export const SIN_BASE = 'El RQ no tiene base y la rama no tiene upstream: no puedo ver qué se va a publicar';

/** true si el paso nunca puede marcarse como no aplica. */
export const pasoObligatorio = (paso) => /^(?:push|merge-prs-sync):/i.test(paso.trim());

/** Primera ruta que impide marcar el paso como no aplica, o undefined. */
export function rutaQueImpide(paso, rutas, proyecto) {
  const p = paso.trim().toLowerCase();
  if (p.startsWith('sql:')) return rutas.find((r) => esMigracion(r, proyecto));
  return p === 'sync-lineamientos' ? rutas.find((r) => RE_ESTANDAR.test(r)) : undefined;
}

function git(raiz, args) {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

/** Commit de HEAD, o null si el repo todavía no tiene commits. */
export function commitHead(raiz) {
  const s = git(raiz, ['rev-parse', 'HEAD']);
  return s === null ? null : s.trim();
}

/** merge-base de HEAD con su upstream, o null si no hay upstream. */
export function baseDeUpstream(raiz) {
  const s = git(raiz, ['merge-base', 'HEAD', '@{u}']);
  return s === null ? null : s.trim();
}

/** Rama principal del remoto: origin/HEAD o, si no está, origin/main u origin/master. null si no hay remoto. */
export function refPrincipal(raiz) {
  const h = git(raiz, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])?.trim();
  if (h && h !== 'origin/HEAD') return h;
  return ['origin/main', 'origin/master'].find((r) => git(raiz, ['rev-parse', '--verify', '-q', `${r}^{commit}`]) !== null) ?? null;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ¿El mensaje nombra el código? Por palabra: R-1 no nombra R-10. */
export const nombraCodigo = (codigo, texto) =>
  new RegExp(`(?:^|[^A-Za-z0-9_-])${escRe(codigo)}(?![A-Za-z0-9_-])`, 'i').test(String(texto ?? ''));

// Entradas del reflog que crean un commit en este checkout (las de merge, pull, reset o checkout lo traen de afuera).
const RE_CREA_COMMIT = /^(?:commit\b|cherry-pick\b|revert\b|am\b|rebase(?: -i)? \((?:pick|reword|edit|squash|fixup)\))/;

/** Commits creados en este checkout según el reflog de HEAD y de la rama actual. */
function creadosAca(raiz) {
  const rama = git(raiz, ['symbolic-ref', '-q', 'HEAD'])?.trim();
  const out = [rama, 'HEAD'].filter(Boolean).map((r) => git(raiz, ['reflog', 'show', '--format=%H%x1f%gs', r]) ?? '').join('\n');
  return new Set(out.split('\n').map((l) => l.split('\x1f')).filter(([h, gs]) => h && RE_CREA_COMMIT.test(gs ?? '')).map(([h]) => h));
}

/**
 * Commits de base..HEAD [{ hash, ajeno }]. Ajeno: llegó al actualizar la rama con main (merge o fast-forward), o sea
 * que ya está en la rama principal, no nombra el código del RQ y no se creó en este checkout. Un commit del RQ cuenta
 * siempre: antes del push no está en main, y después nombra su código o figura en el reflog. Un merge hecho acá
 * nunca es ajeno: lo que trae de main se descuenta con --cc (sólo cuenta lo que resolvió el merge). null si git falla.
 */
function commitsDesde(raiz, base, codigo) {
  const out = git(raiz, ['log', '--format=%H%x1f%B%x1e', `${base}..HEAD`]);
  if (out === null) return null;
  const principal = codigo ? refPrincipal(raiz) : null;
  const enPrincipal = new Set(principal ? (git(raiz, ['rev-list', `${base}..${principal}`]) ?? '').split('\n').filter(Boolean) : []);
  const propios = enPrincipal.size ? creadosAca(raiz) : new Set();
  return out.split('\x1e').map((s) => s.trim().split('\x1f')).filter(([h]) => h)
    .map(([hash, cuerpo]) => ({ hash, ajeno: enPrincipal.has(hash) && !propios.has(hash) && !nombraCodigo(codigo, cuerpo) }));
}

/**
 * Rutas que trae el RQ desde `base`: sus commits, más lo que todavía no se commiteó (en stage, sin stagear
 * o sin trackear). Sin renombres: una migración movida fuera de la carpeta cuenta por su ruta vieja.
 * Con `codigo`, sin las de los commits ajenos que trajo main (ver commitsDesde): una migración de otro RQ que
 * ya está en main no la publica este RQ.
 */
export function rutasDesde(raiz, base, codigo) {
  const commits = commitsDesde(raiz, base, codigo);
  const propios = commits?.filter((c) => !c.ajeno) ?? [];
  const deCommits = commits === null || propios.length === commits.length
    ? [git(raiz, ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`])]
    : propios.map((c) => git(raiz, ['diff-tree', '-r', '--cc', '--no-commit-id', '--name-only', '--no-renames', '-z', c.hash]));
  const partes = [
    ...deCommits,
    git(raiz, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']),
    git(raiz, ['ls-files', '-z', '--others', '--exclude-standard']),
  ];
  if (partes.some((p) => p === null)) return { error: 'No pude leer los cambios del repo con git' };
  return { rutas: [...new Set(partes.flatMap((p) => p.split('\0')).filter(Boolean))] };
}
