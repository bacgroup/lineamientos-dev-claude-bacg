// Stack del proyecto: lo que el plugin necesita saber de la base de datos, las ramas que publican y los agentes que
// trabajan sin el plugin. El valor por defecto es la arquitectura de referencia de BACG (PLG-STACK): Odoo, con las
// migraciones de módulos en **/migrations/**, sin agentes externos y con n8n/Odoo de PROD por `mcp_prod`. Otro stack
// (Supabase + Lovable, Postgres propio, sin base) lo declara:
//
//   datos: { motor: supabase | postgres | odoo | otro | ninguno, migraciones: ["<glob>", …] }
//   ramas_prod: ["main"]                      (por proyecto o por repo: sólo un push/merge a esas ramas es PROD)
//   entornos.prod.bases: ["<id>"]             (bases de PROD fuera de Supabase; los sql:<id> del circuito)
//   agentes_externos: { autores: ["<autor de git>", …] }   (lovable.autores sigue valiendo)

import { globARegExp } from './rutas.mjs';

const lista = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()) : []);
const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');

export const MIGRACIONES_DEFECTO = ['**/migrations/**'];
export const MIGRACIONES_SUPABASE = ['supabase/migrations/**'];
export const AUTORES_LOVABLE = ['gpt-engineer-app[bot]', 'lovable-dev[bot]', 'Lovable'];

/**
 * Motor de base de datos: `datos.motor` declarado; sin declarar, supabase si el proyecto declara refs de Supabase o
 * proyectos de Lovable (stack heredado); si no, null: el plugin sirve a cualquier proyecto y Odoo se decide con
 * usaOdoo(proyecto, raiz), que también detecta addons.
 */
export function motorDatos(proyecto) {
  const declarado = norm(proyecto?.datos?.motor);
  if (declarado) return declarado;
  const refs = lista(proyecto?.entornos?.prod?.supabase_refs).length > 0;
  const sedes = (Array.isArray(proyecto?.repos) ? proyecto.repos : []).some((r) => typeof r?.supabase_ref === 'string' && r.supabase_ref.trim());
  const lovable = Object.keys(proyecto?.lovable?.proyectos ?? {}).length > 0;
  return refs || sedes || lovable ? 'supabase' : null;
}

/**
 * Globs de las migraciones: `datos.migraciones` si está declarado (una lista vacía = el proyecto no tiene
 * migraciones versionadas); si no, las de Supabase, salvo con `datos.motor: ninguno`.
 */
export function globsMigraciones(proyecto) {
  const m = proyecto?.datos?.migraciones;
  if (Array.isArray(m)) return lista(m);
  const motor = motorDatos(proyecto);
  if (motor === 'ninguno') return [];
  return motor === 'supabase' ? MIGRACIONES_SUPABASE : MIGRACIONES_DEFECTO;
}

/** ¿La ruta (relativa al repo, POSIX) es una migración del proyecto? */
export function esMigracion(ruta, proyecto) {
  const r = String(ruta ?? '').replace(/\\/g, '/');
  return globsMigraciones(proyecto).some((g) => globARegExp(g).test(r));
}

/** Bases de PROD: `entornos.prod.supabase_refs` más `entornos.prod.bases`, normalizadas. */
export function basesProd(proyecto) {
  const prod = proyecto?.entornos?.prod;
  return [...new Set([...lista(prod?.supabase_refs), ...lista(prod?.bases)].map(norm).filter(Boolean))];
}

/**
 * Autores de git de los agentes sin el plugin: agentes_externos.autores o lovable.autores; con proyectos de Lovable
 * declarados y sin autores, los de Lovable. En el stack BACG, ninguno.
 */
export function autoresExternos(proyecto) {
  const propios = [...lista(proyecto?.agentes_externos?.autores), ...lista(proyecto?.lovable?.autores)];
  if (propios.length) return [...new Set(propios)];
  return Object.keys(proyecto?.lovable?.proyectos ?? {}).length > 0 ? AUTORES_LOVABLE : [];
}

/**
 * Ramas de PROD de un repo: `ramas_prod` de su entrada en `repos` o, si no la tiene, la del proyecto. null si no
 * se declaró (entonces todo push a un repo PROD es PROD, como antes).
 */
export function ramasProd(proyecto, entradaRepo) {
  for (const x of [entradaRepo?.ramas_prod, proyecto?.ramas_prod]) {
    if (Array.isArray(x)) return lista(x).map((s) => s.trim());
    if (typeof x === 'string' && x.trim()) return [x.trim()];
  }
  return null;
}

/**
 * Ramas que sólo reciben cambios por PR (`ramas_solo_pr`, por repo o por proyecto): un `git push` directo a ellas se
 * niega y se pide abrir un PR; el merge del PR (gh pr merge) sigue sus compuertas normales. [] si no se declaró.
 */
export function ramasSoloPr(proyecto, entradaRepo) {
  for (const x of [entradaRepo?.ramas_solo_pr, proyecto?.ramas_solo_pr]) {
    if (Array.isArray(x)) return lista(x).map((s) => s.trim());
    if (typeof x === 'string' && x.trim()) return [x.trim()];
  }
  return [];
}

/** Base de PROD de un repo (una sede con su propia base): `base` o, en la grafía de Supabase, `supabase_ref`. */
export function baseDelRepo(entradaRepo) {
  const b = entradaRepo?.base ?? entradaRepo?.supabase_ref;
  return typeof b === 'string' && b.trim() ? b.trim() : null;
}

/**
 * Línea para el arranque de sesión con el stack del proyecto, para que el agente no suponga Supabase + Lovable
 * donde no lo hay: motor y migraciones, qué es PROD, cómo es DEV y qué agentes trabajan sin el plugin.
 */
export function lineaStack(proyecto) {
  if (!proyecto || typeof proyecto !== 'object') return null;
  const migs = globsMigraciones(proyecto);
  const ramas = ramasProd(proyecto, null);
  const conRamas = (Array.isArray(proyecto.repos) ? proyecto.repos : []).some((r) => Array.isArray(r?.ramas_prod) || typeof r?.ramas_prod === 'string');
  const dev = proyecto.entornos?.dev ?? {};
  const devTxt = [dev.tipo, dev.rama, dev.url].filter((x) => typeof x === 'string' && x.trim()).join(' ');
  const aplicar = typeof proyecto.datos?.aplicar === 'string' && proyecto.datos.aplicar.trim() ? `; se aplican con: ${proyecto.datos.aplicar.trim()}` : '';
  const lovable = Object.keys(proyecto.lovable?.proyectos ?? {}).length > 0;
  const externos = lista(proyecto.agentes_externos?.autores).length > 0 || lovable;
  return [
    `Stack del proyecto: datos ${motorDatos(proyecto) ?? 'sin declarar'} (${migs.length ? `migraciones ${migs.join(', ')}` : 'sin migraciones versionadas'}${aplicar})`,
    `PROD ${ramas ? `= push o merge a ${ramas.join(', ')}` : conRamas ? '= las ramas_prod de cada repo' : '= todo push a un repo con push_prod'}`,
    `DEV ${devTxt || 'sin declarar'}`,
    `MCP de PROD: ${Array.isArray(proyecto.mcp_prod) && proyecto.mcp_prod.length ? proyecto.mcp_prod.map((m) => `${m?.servidor} (${m?.tipo ?? 'generico'})`).join(', ') : 'ninguno declarado'}`,
    `tests: ${Array.isArray(proyecto.tests_locales) && proyecto.tests_locales.length ? `los de esta PC (${proyecto.tests_locales.join(', ')})` : proyecto.tests?.unit ? 'los de proyecto.yml' : 'sin declarar en esta PC (~/.claude/bacg-dev.json)'}`,
    `PR obligatorio a: ${ramasSoloPr(proyecto, null).join(', ') || 'ninguna rama'}`,
    `agentes sin el plugin: ${externos ? (lovable ? 'Lovable' : 'los de agentes_externos') : 'ninguno declarado'}.`,
  ].join(' · ');
}
