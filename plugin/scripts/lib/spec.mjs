// Lectura de docs/rq/<código>/spec.md compartida por las compuertas de la 4.4 (diseño de UI, traza).
import fs from 'node:fs';
import path from 'node:path';

/** Ítem de lista (viñeta o numerado) con texto. */
export const RE_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;

/** Texto de spec.md del RQ, o '' si no existe o no se puede leer. */
export function leerSpec(raiz, codigo) {
  try {
    return fs.readFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Líneas de la sección cuyo encabezado de `nivel` (2 = ##, 3 = ###) empieza con `titulo` (texto de una regex, sin
 * distinguir mayúsculas), hasta el próximo encabezado de ese nivel o menor; null si no está.
 */
export function seccion(lineasOTexto, nivel, titulo) {
  const lineas = Array.isArray(lineasOTexto) ? lineasOTexto : String(lineasOTexto ?? '').split(/\r?\n/);
  const re = new RegExp(`^\\s*#{${nivel}}(?!#)\\s*${titulo}`, 'i');
  // Las líneas dentro de un bloque de código (``` … ```) no son encabezados aunque empiecen con #.
  let enCodigo = false;
  const fuera = lineas.map((l) => {
    if (/^\s*```/.test(l)) {
      enCodigo = !enCodigo;
      return false;
    }
    return !enCodigo;
  });
  const i = lineas.findIndex((l, k) => fuera[k] && re.test(l));
  if (i === -1) return null;
  const fin = new RegExp(`^\\s*#{1,${nivel}}(?!#)`);
  const out = [];
  for (let k = i + 1; k < lineas.length; k++) {
    if (fuera[k] && fin.test(lineas[k])) break;
    out.push(lineas[k]);
  }
  return out;
}
