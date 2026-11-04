// Stack del proyecto: lo que el plugin necesita saber de la base de datos, las ramas que publican y los agentes que
// trabajan sin el plugin. El valor por defecto es la arquitectura de referencia histórica (Supabase + Lovable): un
// proyecto.yml que no declara nada se comporta como antes. Otro stack (Postgres propio, Odoo, sin base) lo declara:
//
//   datos: { motor: supabase | postgres | odoo | otro | ninguno, migraciones: ["<glob>", …] }
//   ramas_prod: ["main"]                      (por proyecto o por repo: sólo un push/merge a esas ramas es PROD)
//   entornos.prod.bases: ["<id>"]             (bases de PROD fuera de Supabase; los sql:<id> del circuito)
//   agentes_externos: { autores: ["<autor de git>", …] }   (lovable.autores sigue valiendo)

import { globARegExp } from './rutas.mjs';

const lista = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()) : []);
const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');

export const MOTOR_DEFECTO = 'supabase';
export const MIGRACIONES_DEFECTO = ['supabase/migrations/**'];
export const AUTORES_LOVABLE = ['gpt-engineer-app[bot]', 'lovable-dev[bot]', 'Lovable'];

/** Motor de base de datos declarado (`datos.motor`), en minúsculas; sin declarar, supabase. */
export const motorDatos = (proyecto) => norm(proyecto?.datos?.motor) || MOTOR_DEFECTO;

/**
 * Globs de las migraciones: `datos.migraciones` si está declarado (una lista vacía = el proyecto no tiene
 * migraciones versionadas); si no, las de Supabase, salvo con `datos.motor: ninguno`.
 */
export function globsMigraciones(proyecto) {
  const m = proyecto?.datos?.migraciones;
  if (Array.isArray(m)) return lista(m);
  return motorDatos(proyecto) === 'ninguno' ? [] : MIGRACIONES_DEFECTO;
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

/** Autores de git de los agentes sin el plugin: agentes_externos.autores, lovable.autores o los de Lovable. */
export function autoresExternos(proyecto) {
  const propios = [...lista(proyecto?.agentes_externos?.autores), ...lista(proyecto?.lovable?.autores)];
  return propios.length ? [...new Set(propios)] : AUTORES_LOVABLE;
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
    `Stack del proyecto: datos ${motorDatos(proyecto)} (${migs.length ? `migraciones ${migs.join(', ')}` : 'sin migraciones versionadas'}${aplicar})`,
    `PROD ${ramas ? `= push o merge a ${ramas.join(', ')}` : conRamas ? '= las ramas_prod de cada repo' : '= todo push a un repo con push_prod'}`,
    `DEV ${devTxt || 'sin declarar'}`,
    `agentes sin el plugin: ${externos ? (lovable ? 'Lovable' : 'los de agentes_externos') : 'ninguno declarado'}.`,
  ].join(' · ');
}
