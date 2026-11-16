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
  const re = new RegExp(`^\\s*#{${nivel}}\\s*${titulo}`, 'i');
  const i = lineas.findIndex((l) => re.test(l) && !new RegExp(`^\\s*#{${nivel + 1}}`).test(l));
  if (i === -1) return null;
  const fin = new RegExp(`^\\s*#{1,${nivel}}\\s`);
  const out = [];
  for (const l of lineas.slice(i + 1)) {
    if (fin.test(l)) break;
    out.push(l);
  }
  return out;
}
