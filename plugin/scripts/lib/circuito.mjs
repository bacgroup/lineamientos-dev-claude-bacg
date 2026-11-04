// Circuito de PROD de un RQ: qué pasos de circuito_prod le corresponden, de qué depende cada uno y cuáles faltan.
//
// - Un paso corresponde según lo que trae el RQ desde su base: sql:<ref> sólo si trae migraciones y
//   sync-lineamientos sólo si trae estándares. Si no se puede leer el diff, corresponden todos (falla cerrada).
// - Las migraciones son las de `datos.migraciones` (por defecto, supabase/migrations/; ver stack.mjs).
// - El sql:<ref> de una sede (repos[].base o supabase_ref) corresponde además si el PR de sync abierto de esa sede
//   trae migraciones: una migración que Lovable creó antes de abrir el RQ no está en su diff pero sí viaja a
//   la sede. Si el PR no se puede leer, corresponde (falla cerrada).
// - Cada paso depende de lo que declara `despues_de` en proyecto.yml; sin esa clave, de todos los anteriores.
// - Los pasos manuales (manual:<texto> y sync-lineamientos) nunca bloquean a otro paso: quedan como pendientes.
// - Un paso cuenta como hecho si está registrado (o marcado no aplica) o si el estado real lo muestra hecho:
//   push sin commits por subir, PR de sync de la sede sin abrir.

import { spawnSync } from 'node:child_process';
import { buscarRepo, nombreRepo } from './config.mjs';
import { baseDeUpstream, rutaQueImpide, rutasDesde } from './no-aplica.mjs';
import { baseDelRepo, esMigracion } from './stack.mjs';

const lista = (x) => (Array.isArray(x) ? x : []);
const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');

export const RAMA_SYNC = 'sync/padre-acumulado';
export const esManual = (paso) => /^manual:\S/i.test(String(paso).trim()) || norm(paso) === 'sync-lineamientos';

/** Pasos de circuito_prod: [{ paso, despues_de }] con despues_de = lista o null (todos los anteriores). */
export function pasosCircuito(proyecto) {
  return lista(proyecto?.circuito_prod)
    .filter((p) => p && typeof p.paso === 'string')
    .map((p) => ({ paso: p.paso, despues_de: Array.isArray(p.despues_de) ? p.despues_de : null }));
}

/** Rutas que trae el RQ desde su base (sin los commits ajenos que trajo main), o null si no se pueden leer. */
export function rutasDelRq(raiz, estado) {
  if (!raiz) return null;
  const base = typeof estado?.base === 'string' && estado.base ? estado.base : baseDeUpstream(raiz);
  if (!base) return null;
  const { rutas, error } = rutasDesde(raiz, base, estado?.codigo);
  return error ? null : rutas;
}

/**
 * ¿El paso corresponde a un RQ que trae estas rutas? (rutas null = no se sabe = corresponde). `sedes` es
 * { <ref>: true | false | null } con las migraciones de los PR de sync (ver migracionesEnSync). `proyecto` dice qué
 * rutas son migraciones.
 */
export function corresponde(paso, rutas, sedes = {}, proyecto = null) {
  const p = norm(paso);
  if (p.startsWith('sql:')) {
    const enSync = sedes[p.slice(4)];
    if (enSync === true || enSync === null) return true;
  }
  if (!Array.isArray(rutas)) return true;
  if (p.startsWith('sql:') || p === 'sync-lineamientos') return rutaQueImpide(paso, rutas, proyecto) !== undefined;
  return true;
}

const registrado = (estado, paso) => lista(estado?.circuito).some((c) => norm(c?.paso) === norm(paso));

function git(raiz, args) {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Estado real de un paso, sin mirar estado.circuito. `raiz` es el repo del RQ. Sólo responde true cuando lo
 * puede comprobar: push sin commits locales por subir; merge sin PR de sync abierto en la sede.
 */
export function hechoEnRealidad(paso, { raiz, proyecto }) {
  const p = norm(paso);
  try {
    if (p.startsWith('push:')) {
      const nombre = p.slice(5);
      const entrada = lista(proyecto?.repos).find((r) => norm(r?.nombre) === nombre);
      let dir = raiz && norm(nombreRepo(raiz)) === nombre ? raiz : null;
      if (!dir && entrada?.ruta_local) dir = buscarRepo(entrada.ruta_local)?.raiz ?? null;
      if (!dir) return false;
      const pendientes = git(dir, ['rev-list', '--count', '@{u}..HEAD']);
      return pendientes === '0';
    }
    if (p.startsWith('merge-prs-sync:')) {
      const cuenta = proyecto?.cuenta_github;
      if (!cuenta) return false;
      const repo = paso.trim().slice('merge-prs-sync:'.length);
      const rama = proyecto?.sync?.rama || RAMA_SYNC;
      const r = spawnSync('gh', ['pr', 'list', '-R', `${cuenta}/${repo}`, '--head', rama, '--state', 'open', '--json', 'number'], {
        encoding: 'utf8',
        timeout: 15000,
      });
      if (r.status !== 0) return false;
      return Array.isArray(JSON.parse(r.stdout || 'null')) && JSON.parse(r.stdout).length === 0;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Migraciones en los PR de sync abiertos de las sedes: { <base>: true | false | null }. true = el PR
 * trae migraciones del proyecto; false = no las trae o no hay PR abierto; null = no se pudo leer. `soloSede`
 * limita la consulta a un repo de sede (por nombre).
 */
export function migracionesEnSync(proyecto, soloSede = null) {
  const out = {};
  const cuenta = proyecto?.cuenta_github;
  const rama = proyecto?.sync?.rama || RAMA_SYNC;
  for (const r of lista(proyecto?.repos)) {
    if (r?.rol !== 'sede' || !baseDelRepo(r)) continue;
    if (soloSede && norm(r.nombre) !== norm(soloSede)) continue;
    const ref = norm(baseDelRepo(r));
    if (!cuenta) {
      out[ref] = null;
      continue;
    }
    try {
      const x = spawnSync('gh', ['pr', 'list', '-R', `${cuenta}/${r.nombre}`, '--head', rama, '--state', 'open', '--json', 'files'], {
        encoding: 'utf8',
        timeout: 15000,
      });
      if (x.status !== 0) {
        out[ref] = null;
        continue;
      }
      const prs = JSON.parse(x.stdout || '[]');
      out[ref] = prs.some((pr) => lista(pr?.files).some((a) => esMigracion(a?.path, proyecto)));
    } catch {
      out[ref] = null;
    }
  }
  return out;
}

/** ¿El paso está hecho? Registrado, marcado no aplica o comprobado en la realidad. */
export function pasoHecho(paso, { estado, raiz, proyecto, real = hechoEnRealidad }) {
  return registrado(estado, paso) || real(paso, { raiz, proyecto });
}

/** Pasos de los que depende `paso` (sin los manuales), con la grafía de circuito_prod. */
export function dependencias(proyecto, paso) {
  const pasos = pasosCircuito(proyecto);
  const idx = pasos.findIndex((x) => norm(x.paso) === norm(paso));
  if (idx === -1) return [];
  const declarados = pasos[idx].despues_de;
  const deps = declarados === null ? pasos.slice(0, idx).map((x) => x.paso) : declarados;
  return deps
    .map((d) => pasos.find((x) => norm(x.paso) === norm(d))?.paso ?? d)
    .filter((d) => !esManual(d));
}

/**
 * Primer paso del que depende `paso` y que falta, o undefined. `rutas` decide qué pasos corresponden (null =
 * todos); `real` comprueba el estado real (inyectable en los tests).
 */
export function faltaAntes({ proyecto, estado, paso, raiz, rutas, sedes = {}, real = hechoEnRealidad }) {
  if (!pasosCircuito(proyecto).some((x) => norm(x.paso) === norm(paso))) return undefined;
  return dependencias(proyecto, paso).find(
    (d) => corresponde(d, rutas, sedes, proyecto) && !pasoHecho(d, { estado, raiz, proyecto, real }),
  );
}

/** Pasos que corresponden al RQ y todavía no están hechos (para el cierre y el plan de despliegue). */
export function pendientes({ proyecto, estado, raiz, rutas, sedes = {}, real = hechoEnRealidad }) {
  return pasosCircuito(proyecto)
    .map((x) => x.paso)
    .filter((p) => corresponde(p, rutas, sedes, proyecto) && !pasoHecho(p, { estado, raiz, proyecto, real }));
}

