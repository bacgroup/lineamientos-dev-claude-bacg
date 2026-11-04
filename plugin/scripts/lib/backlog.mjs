// Backlog del proyecto, una fila por RQ. Es la única fuente: el CLI agrega la fila al abrir el RQ y la pasa a Hecho
// al cerrarlo. Con la configuración en el repo (.bacg-dev/) vive en docs/backlog.md del repo; si no, en
// lineamientos-bacg/proyectos/<id>/backlog.md (rq.mjs le deja una copia en docs/backlog.md).

import fs from 'node:fs';
import path from 'node:path';
import { configEnRepo } from './config.mjs';

export const COLUMNAS = ['Código', 'Tarea', 'Prioridad', 'Estado', 'Impacto', 'Link'];
const ENCABEZADO = `| ${COLUMNAS.join(' | ')} |`;
const SEPARADOR = `|${COLUMNAS.map(() => '---').join('|')}|`;

export const rutaBacklog = (dirLin, proyectoId, raiz) =>
  configEnRepo(raiz) ? path.join(raiz, 'docs', 'backlog.md') : path.join(dirLin, 'proyectos', proyectoId, 'backlog.md');

const celda = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const esFila = (l) => /^\|/.test(l.trim()) && !/^\|\s*-/.test(l.trim());

function partir(linea) {
  return linea.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Filas del backlog como objetos { Código, Tarea, ... }. */
export function leerBacklog(dirLin, proyectoId, raiz) {
  let texto;
  try {
    texto = fs.readFileSync(rutaBacklog(dirLin, proyectoId, raiz), 'utf8');
  } catch {
    return [];
  }
  const filas = texto.split(/\r?\n/).filter(esFila).slice(1);
  return filas.map((l) => Object.fromEntries(partir(l).map((v, i) => [COLUMNAS[i] ?? `c${i}`, v])));
}

/**
 * Agrega o actualiza la fila de `codigo`. `campos` pisa sólo lo que trae (una Tarea vacía no borra la vigente).
 * Si el archivo no existe, lo crea con el encabezado. Devuelve 'agregada' | 'actualizada'.
 */
export function upsertFila(dirLin, proyectoId, codigo, campos, raiz) {
  const archivo = rutaBacklog(dirLin, proyectoId, raiz);
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
