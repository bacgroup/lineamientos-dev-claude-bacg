// Trazabilidad del spec al código y a los tests (PLG-DFF2, P-16). Cada ítem de "## Criterio de aceptación" de spec.md
// recibe un id (el S-n que trae o uno correlativo) y una fila en docs/rq/<código>/traza.yml con los archivos que lo
// implementan, el test que lo prueba y su estado (hecho | parcial | fuera). Con reglas 4.4, en Acotado y Arquitectónico
// la revisión no se da por ok con ítems sin estado o "hecho" sin test. Falla cerrada: sin traza.yml legible, falta.
import fs from 'node:fs';
import path from 'node:path';
import yaml from '../vendor/js-yaml.mjs';

const RE_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;
const RE_ID = /^(S-\d+)\s*[:.)-]\s*/i;
export const ESTADOS_TRAZA = ['hecho', 'parcial', 'fuera'];

/** Ítems de "## Criterio de aceptación" (hasta el próximo ## ): [{ id, texto }]. */
export function itemsDelSpec(texto) {
  const lineas = String(texto ?? '').split(/\r?\n/);
  const i = lineas.findIndex((l) => /^\s*##\s*criterios? de aceptaci[oó]n\b/i.test(l));
  if (i === -1) return [];
  const out = [];
  for (const l of lineas.slice(i + 1)) {
    if (/^\s*##\s/.test(l)) break;
    const m = l.match(RE_ITEM);
    if (!m) continue;
    const id = m[1].match(RE_ID);
    out.push({ id: id ? id[1].toUpperCase() : null, texto: id ? m[1].slice(id[0].length).trim() : m[1] });
  }
  let n = 0;
  const usados = new Set(out.map((x) => x.id).filter(Boolean));
  for (const x of out) {
    if (x.id) continue;
    do n += 1; while (usados.has(`S-${n}`));
    x.id = `S-${n}`;
    usados.add(x.id);
  }
  return out;
}

const archivoTraza = (raiz, codigo) => path.join(raiz, 'docs', 'rq', codigo, 'traza.yml');
const leerSpec = (raiz, codigo) => {
  try {
    return fs.readFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), 'utf8');
  } catch {
    return '';
  }
};

function leerTraza(raiz, codigo) {
  try {
    const t = yaml.load(fs.readFileSync(archivoTraza(raiz, codigo), 'utf8'));
    return t && Array.isArray(t.items) ? t : null;
  } catch {
    return null;
  }
}

/** Crea o completa traza.yml desde el spec, sin pisar lo ya completado. Devuelve { total, nuevos, ruta }. */
export function trazar(raiz, codigo) {
  const items = itemsDelSpec(leerSpec(raiz, codigo));
  const previa = leerTraza(raiz, codigo);
  const porId = new Map((previa?.items ?? []).filter((x) => x?.id).map((x) => [String(x.id).toUpperCase(), x]));
  let nuevos = 0;
  const filas = items.map(({ id, texto }) => {
    const ya = porId.get(id);
    if (ya) return { ...ya, id, texto };
    nuevos += 1;
    return { id, texto, archivos: [], test: '', estado: '' };
  });
  const ruta = archivoTraza(raiz, codigo);
  const cabecera = '# Traza del spec al código y a los tests (rq.mjs trazar). estado: hecho | parcial | fuera (con motivo).\n# Un "hecho" lleva el test que prueba el comportamiento, no sólo que aparece un texto.\n';
  fs.writeFileSync(ruta, cabecera + yaml.dump({ items: filas }, { lineWidth: -1 }));
  return { total: filas.length, nuevos, ruta: path.relative(raiz, ruta).split(path.sep).join('/') };
}

/** Lo que le falta a la traza para la revisión ([] si está completa o si el spec no trae criterios). */
export function faltasTraza(raiz, codigo) {
  const items = itemsDelSpec(leerSpec(raiz, codigo));
  if (!items.length) return [];
  const t = leerTraza(raiz, codigo);
  if (!t) return [`la traza del spec en docs/rq/${codigo}/traza.yml ($RQ trazar y completala)`];
  const porId = new Map(t.items.filter((x) => x?.id).map((x) => [String(x.id).toUpperCase(), x]));
  const falta = [];
  for (const { id } of items) {
    const f = porId.get(id);
    if (!f) falta.push(`${id} sin fila en traza.yml ($RQ trazar)`);
    else if (!ESTADOS_TRAZA.includes(f.estado)) falta.push(`${id} sin estado en traza.yml (hecho | parcial | fuera)`);
    else if (f.estado === 'hecho' && !(typeof f.test === 'string' && f.test.trim())) falta.push(`${id} "hecho" sin el test que lo prueba en traza.yml`);
  }
  return falta;
}
