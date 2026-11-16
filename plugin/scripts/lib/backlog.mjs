// Backlog del proyecto, una fila por RQ. Es la única fuente: el CLI agrega la fila al abrir el RQ y la pasa a Hecho
// al cerrarlo. Con la configuración en el repo (.bacg-dev/) vive en docs/backlog.md del repo; si no, en
// lineamientos-dev-claude-bacg/proyectos/<id>/backlog.md (rq.mjs le deja una copia en docs/backlog.md).

import fs from 'node:fs';
import path from 'node:path';
import { configEnRepo } from './config.mjs';

export const COLUMNAS = ['Código', 'Tarea', 'Prioridad', 'Estado', 'Impacto', 'Link'];
const ENCABEZADO = `| ${COLUMNAS.join(' | ')} |`;
const SEPARADOR = `|${COLUMNAS.map(() => '---').join('|')}|`;

/**
 * PLG-BACKLOG: de dónde es la fuente del backlog. `repo` (docs/backlog.md del repo) si la configuración está en el repo
 * o si el proyecto declara `backlog: repo`; si no, `central` (proyectos/<id>/backlog.md de lineamientos, con una copia
 * en el repo que se fusiona, nunca se pisa).
 */
export const fuenteBacklog = (raiz, proyecto) => (configEnRepo(raiz) || String(proyecto?.backlog ?? '').trim() === 'repo' ? 'repo' : 'central');

export const rutaBacklog = (dirLin, proyectoId, raiz, proyecto) =>
  fuenteBacklog(raiz, proyecto) === 'repo' ? path.join(raiz, 'docs', 'backlog.md') : path.join(dirLin, 'proyectos', proyectoId, 'backlog.md');

/** Rango de un estado: Hecho y Descartado (cerrados) > En curso > el resto (Pendiente, Propuesta…). */
export function rangoEstado(estado) {
  const e = String(estado ?? '').trim().toLowerCase();
  if (/^(?:hecho|descartado)/.test(e)) return 3;
  if (/en curso/.test(e)) return 2;
  return e ? 1 : 0;
}

/** Une dos listas de filas por código: gana la de estado más avanzado; los vacíos se completan con la otra. */
export function fusionarFilas(a, b) {
  const orden = [];
  const por = new Map();
  for (const f of [...(a ?? []), ...(b ?? [])]) {
    const c = String(f?.['Código'] ?? '').trim();
    if (!c) continue;
    const ya = por.get(c);
    if (!ya) {
      orden.push(c);
      por.set(c, { ...f });
      continue;
    }
    const [gana, pierde] = rangoEstado(f.Estado) > rangoEstado(ya.Estado) ? [f, ya] : [ya, f];
    const out = { ...gana };
    for (const k of COLUMNAS) if (!String(out[k] ?? '').trim() && String(pierde[k] ?? '').trim()) out[k] = pierde[k];
    por.set(c, out);
  }
  return orden.map((c) => por.get(c));
}

/** Códigos que están en una sola copia o con distinto estado. */
export function diferencias(a, b) {
  const ma = new Map((a ?? []).map((f) => [String(f['Código']).trim(), String(f.Estado ?? '').trim()]));
  const mb = new Map((b ?? []).map((f) => [String(f['Código']).trim(), String(f.Estado ?? '').trim()]));
  return [...new Set([...ma.keys(), ...mb.keys()])].filter((c) => c && ma.get(c) !== mb.get(c));
}

/** Escribe las filas como tabla, conservando el texto anterior a la tabla (o un encabezado si el archivo no existe). */
export function escribirFilas(archivo, filas) {
  let antes = '# Backlog\n';
  try {
    const lineas = fs.readFileSync(archivo, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const i = lineas.findIndex((l) => /^\|/.test(l.trim()));
    antes = (i === -1 ? lineas : lineas.slice(0, i)).join('\n').replace(/\n*$/, '\n');
  } catch {
    // archivo nuevo
  }
  const tabla = filas.map((f) => `| ${COLUMNAS.map((c) => celda(f[c])).join(' | ')} |`);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, `${antes}\n${ENCABEZADO}\n${SEPARADOR}\n${tabla.join('\n')}\n`);
}

/** Filas de un archivo de backlog ([] si no existe). */
export function filasDe(archivo) {
  try {
    return parsearBacklog(fs.readFileSync(archivo, 'utf8'));
  } catch {
    return [];
  }
}

function celda(v) {
  return String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}
const esFila = (l) => /^\|/.test(l.trim()) && !/^\|\s*-/.test(l.trim());

function partir(linea) {
  return linea.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Filas de un texto de backlog como objetos { Código, Tarea, ... } (sin el encabezado). */
export function parsearBacklog(texto) {
  const filas = String(texto ?? '').split(/\r?\n/).filter(esFila).slice(1);
  return filas.map((l) => Object.fromEntries(partir(l).map((v, i) => [COLUMNAS[i] ?? `c${i}`, v])));
}

/** Filas del backlog como objetos { Código, Tarea, ... }. */
export function leerBacklog(dirLin, proyectoId, raiz, proyecto) {
  let texto;
  try {
    texto = fs.readFileSync(rutaBacklog(dirLin, proyectoId, raiz, proyecto), 'utf8');
  } catch {
    return [];
  }
  return parsearBacklog(texto);
}

/**
 * Agrega o actualiza la fila de `codigo`. `campos` pisa sólo lo que trae (una Tarea vacía no borra la vigente).
 * Si el archivo no existe, lo crea con el encabezado. Devuelve 'agregada' | 'actualizada'.
 */
export function upsertFila(dirLin, proyectoId, codigo, campos, raiz, proyecto) {
  const archivo = rutaBacklog(dirLin, proyectoId, raiz, proyecto);
  let texto;
  try {
    texto = fs.readFileSync(archivo, 'utf8');
  } catch {
    texto = `# Backlog\n\n${ENCABEZADO}\n${SEPARADOR}\n`;
  }
  const lineas = texto.replace(/\r\n/g, '\n').split('\n');
  const idx = lineas.findIndex((l) => esFila(l) && partir(l)[0] === codigo);
  const previa = idx === -1 ? {} : Object.fromEntries(partir(lineas[idx]).map((v, i) => [COLUMNAS[i], v]));
  const fila = { ...previa, Código: codigo };
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null && String(v).trim() !== '') fila[k] = v;
  const linea = `| ${COLUMNAS.map((c) => celda(fila[c])).join(' | ')} |`;
  if (idx !== -1) {
    lineas[idx] = linea;
  } else {
    let ultima = -1;
    lineas.forEach((l, i) => { if (/^\|/.test(l.trim())) ultima = i; });
    if (ultima === -1) {
      while (lineas.length && lineas[lineas.length - 1] === '') lineas.pop();
      lineas.push('', ENCABEZADO, SEPARADOR, linea);
    } else {
      lineas.splice(ultima + 1, 0, linea);
    }
  }
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, `${lineas.join('\n').replace(/\n*$/, '')}\n`);
  return idx === -1 ? 'agregada' : 'actualizada';
}
