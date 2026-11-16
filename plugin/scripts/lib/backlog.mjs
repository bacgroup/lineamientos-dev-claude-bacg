// Backlog del proyecto, una fila por RQ: el CLI agrega la fila al abrir el RQ y la pasa a Hecho al cerrarlo.
// PLG-BACKLOG: la fuente es docs/backlog.md del repo si la configuración está en el repo o el proyecto declara
// `backlog: repo`; si no, proyectos/<id>/backlog.md de lineamientos, con una copia en docs/backlog.md del repo que se
// FUSIONA (nunca se pisa): por código gana el estado más avanzado y no se pierde ninguna fila, columna ni texto.

import fs from 'node:fs';
import path from 'node:path';
import { configEnRepo } from './config.mjs';

export const COLUMNAS = ['Código', 'Tarea', 'Prioridad', 'Estado', 'Impacto', 'Link'];
const ENCABEZADO = `| ${COLUMNAS.join(' | ')} |`;
const SEPARADOR = `|${COLUMNAS.map(() => '---').join('|')}|`;

/** `repo` o `central`: de dónde es la fuente del backlog. */
export const fuenteBacklog = (raiz, proyecto) => (configEnRepo(raiz) || String(proyecto?.backlog ?? '').trim() === 'repo' ? 'repo' : 'central');

/** Ruta del backlog central de lineamientos de un proyecto. */
export const rutaCentral = (dirLin, proyectoId) => path.join(dirLin, 'proyectos', proyectoId, 'backlog.md');

export const rutaBacklog = (dirLin, proyectoId, raiz, proyecto) =>
  fuenteBacklog(raiz, proyecto) === 'repo' ? path.join(raiz, 'docs', 'backlog.md') : rutaCentral(dirLin, proyectoId);

/**
 * Rango de un estado: 3 cerrado (Hecho, Descartado, Cerrado, sin "falta"), 2 en curso (o en revisión, en QA, desplegado) o hecho parcial ("Hecho … Falta:
 * …"), 1 el resto (Pendiente, Propuesta…), 0 vacío.
 */
export function rangoEstado(estado) {
  const e = String(estado ?? '').trim().toLowerCase();
  if (!e) return 0;
  if (/^(?:hecho|descartado|cerrado)/.test(e)) return /falta/.test(e) ? 2 : 3;
  if (/en curso|en revisi[oó]n|en qa|en pruebas|desplegad/.test(e)) return 2;
  return 1;
}

// Un | sin escapar en un valor que escribe la CLI pasa a / (no rompe la tabla); un \| ya escapado en el archivo se respeta.
const celda = (v) => String(v ?? '').replace(/(?<!\\)\|/g, '/').replace(/\s+/g, ' ').trim();
const esFila = (l) => /^\|/.test(l.trim()) && !/^\|\s*:?-/.test(l.trim());

/** Celdas de una línea de tabla; un `\|` escapado es parte de la celda. */
function partir(linea) {
  return linea.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

const esSeparador = (l) => /^\|\s*:?-/.test(String(l ?? '').trim());

/**
 * Índices de las filas de datos del backlog a partir de su encabezado `iEnc`. La tabla sigue hasta el final del archivo
 * o hasta que empieza OTRA tabla (una fila seguida de una línea separadora): líneas en blanco o texto entre grupos de
 * filas no la cortan (PLG-BKL2), y una tabla posterior con su propio encabezado (notas, glosario) no es backlog.
 */
function indicesDeFilas(lineas, iEnc) {
  const out = [];
  for (let i = iEnc + 1; i < lineas.length; i++) {
    if (!esFila(lineas[i])) continue;
    if (esSeparador(lineas[i + 1])) break;
    out.push(i);
  }
  return out;
}

/** Filas de un texto de backlog como objetos { Código, Tarea, ... } (sin el encabezado). */
export function parsearBacklog(texto) {
  const lineas = String(texto ?? '').split(/\r?\n/);
  const ini = lineas.findIndex(esFila);
  if (ini === -1) return [];
  const cols = partir(lineas[ini]);
  return indicesDeFilas(lineas, ini).map((k) => Object.fromEntries(partir(lineas[k]).map((v, i) => [cols[i] ?? COLUMNAS[i] ?? `c${i}`, v])));
}

/** Filas de un archivo de backlog ([] si no existe). */
export function filasDe(archivo) {
  try {
    return parsearBacklog(fs.readFileSync(archivo, 'utf8'));
  } catch {
    return [];
  }
}

/** Filas del backlog del proyecto (de su fuente). */
export function leerBacklog(dirLin, proyectoId, raiz, proyecto) {
  return filasDe(rutaBacklog(dirLin, proyectoId, raiz, proyecto));
}

/** Códigos que están en una sola copia o con distinto estado (las filas sin código no cuentan). */
export function diferencias(a, b) {
  const mapa = (l) => new Map((l ?? []).map((f) => [String(f?.['Código'] ?? '').trim(), String(f?.Estado ?? '').trim()]).filter(([c]) => c));
  const ma = mapa(a);
  const mb = mapa(b);
  return [...new Set([...ma.keys(), ...mb.keys()])].filter((c) => ma.get(c) !== mb.get(c));
}

// Texto del archivo (o uno nuevo con el encabezado) en líneas, con la tabla ubicada: { lineas, cols, filas: Map<código, índice> }.
function abrirTabla(archivo) {
  let texto;
  try {
    texto = fs.readFileSync(archivo, 'utf8');
  } catch {
    texto = `# Backlog\n\n${ENCABEZADO}\n${SEPARADOR}\n`;
  }
  const lineas = texto.replace(/\r\n/g, '\n').split('\n');
  const iEnc = lineas.findIndex(esFila);
  if (iEnc === -1) {
    while (lineas.length && lineas[lineas.length - 1] === '') lineas.pop();
    lineas.push('', ENCABEZADO, SEPARADOR);
    return abrirTabla.desde(lineas, lineas.length - 2);
  }
  return abrirTabla.desde(lineas, iEnc);
}
abrirTabla.desde = (lineas, iEnc) => {
  const cols = partir(lineas[iEnc]);
  const filas = new Map();
  // Las filas nuevas van al final del primer grupo contiguo; los códigos se buscan en todos los grupos de la tabla.
  let ultima = iEnc;
  // Mismo límite que indicesDeFilas: una fila seguida de un separador es el encabezado de otra tabla.
  while (ultima + 1 < lineas.length && /^\|/.test(lineas[ultima + 1].trim()) && !(esFila(lineas[ultima + 1]) && esSeparador(lineas[ultima + 2]))) ultima++;
  for (const i of indicesDeFilas(lineas, iEnc)) {
    const c = partir(lineas[i])[0];
    if (c && !filas.has(c)) filas.set(c, i);
  }
  return { lineas, cols, filas, ultima };
};

const lineaDe = (cols, valores) => `| ${cols.map((c, i) => celda(valores[c] ?? valores[COLUMNAS[i]] ?? '')).join(' | ')} |`;

function guardar(archivo, lineas, original) {
  const texto = `${lineas.join('\n').replace(/\n*$/, '')}\n`;
  if (texto === original) return;
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, texto);
}

const leer = (archivo) => {
  try {
    return fs.readFileSync(archivo, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Fusiona `filas` en el archivo sin reescribirlo: agrega las filas cuyo código falta (después de la última fila de la
 * tabla) y, en las que ya están, cambia sólo la celda Estado si el de `filas` es más avanzado. El resto del archivo
 * (columnas extra, filas sin código, texto antes y después de la tabla) queda igual. Devuelve { agregadas, actualizadas }.
 */
export function fusionarEnArchivo(archivo, filas) {
  const original = leer(archivo);
  const t = abrirTabla(archivo);
  const iEstado = t.cols.indexOf('Estado');
  const agregadas = [];
  const actualizadas = [];
  const nuevas = [];
  for (const f of filas ?? []) {
    const c = String(f?.['Código'] ?? '').trim();
    if (!c) continue;
    const i = t.filas.get(c);
    if (i === undefined) {
      if (nuevas.some((n) => n.c === c)) continue;
      nuevas.push({ c, linea: lineaDe(t.cols, f) });
      agregadas.push(c);
    } else if (iEstado !== -1 && rangoEstado(f.Estado) > rangoEstado(partir(t.lineas[i])[iEstado])) {
      const celdas = partir(t.lineas[i]);
      celdas[iEstado] = celda(f.Estado);
      t.lineas[i] = `| ${celdas.join(' | ')} |`;
      actualizadas.push(c);
    }
  }
  if (nuevas.length) t.lineas.splice(t.ultima + 1, 0, ...nuevas.map((n) => n.linea));
  if (agregadas.length || actualizadas.length || original === null) guardar(archivo, t.lineas, original);
  return { agregadas, actualizadas };
}

/**
 * Agrega o actualiza la fila de `codigo` en `archivo`: pisa sólo los campos que trae `campos` (una Tarea vacía no borra
 * la vigente) y deja el resto de la fila y del archivo igual. Devuelve 'agregada' | 'actualizada'.
 */
export function upsertEnArchivo(archivo, codigo, campos) {
  const original = leer(archivo);
  const t = abrirTabla(archivo);
  const i = t.filas.get(codigo);
  const previa = i === undefined ? {} : Object.fromEntries(partir(t.lineas[i]).map((v, k) => [t.cols[k] ?? `c${k}`, v]));
  const fila = { ...previa, Código: codigo };
  for (const [k, v] of Object.entries(campos ?? {})) if (v !== undefined && v !== null && String(v).trim() !== '') fila[k] = v;
  const extra = i === undefined ? [] : partir(t.lineas[i]).slice(t.cols.length);
  const linea = `| ${[...t.cols.map((c) => celda(fila[c])), ...extra].join(' | ')} |`;
  if (i !== undefined) t.lineas[i] = linea;
  else t.lineas.splice(t.ultima + 1, 0, linea);
  guardar(archivo, t.lineas, original);
  return i === undefined ? 'agregada' : 'actualizada';
}

/** Columnas del encabezado de la tabla del archivo (COLUMNAS si no existe o no tiene tabla). */
export function columnasDe(archivo) {
  return abrirTabla(archivo).cols;
}

/** Crea `archivo` con el título y el encabezado de la tabla de `modelo` (sin filas), si `archivo` no existe. */
export function crearConEncabezadoDe(archivo, modelo) {
  if (fs.existsSync(archivo)) return;
  const cols = columnasDe(modelo);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, `# Backlog\n\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n`);
}

/** upsertEnArchivo sobre la fuente del backlog del proyecto. */
export function upsertFila(dirLin, proyectoId, codigo, campos, raiz, proyecto) {
  return upsertEnArchivo(rutaBacklog(dirLin, proyectoId, raiz, proyecto), codigo, campos);
}
