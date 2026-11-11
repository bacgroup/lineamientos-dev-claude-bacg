// PLG-CTX (4.2.0): compacta salidas largas de comandos sin perder lo que importa para decidir.
//
// Texto (logs, tests, docker): saca códigos ANSI, colapsa líneas repetidas consecutivas (iguales salvo números) y,
// si sigue largo, conserva el principio, el final y cada línea crítica (error, falla, traceback…) con su contexto.
// JSON (gh api, gh --json): saca campos de ruido (node_id, *_url salvo html_url, avatares), recorta listas largas y
// textos largos. Es determinístico y local: no llama a ningún modelo ni servicio.
// Lo usan rq.mjs (salida de tests y E2E que fallan) y el hook PostToolUse (salidas de Bash/PowerShell).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RE_ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const DIAS_RETENCION = 7;

/** Carpeta de las salidas originales: ~/.claude/bacg-dev/salidas. */
export const dirSalidas = (home = os.homedir()) => path.join(home, '.claude', 'bacg-dev', 'salidas');

/**
 * Guarda `cuerpo` en ~/.claude/bacg-dev/salidas/<fecha>-<id>.txt y devuelve la ruta (lanza si no puede). Borra de
 * paso las de más de 7 días.
 */
export function guardarSalida({ cuerpo, id, home = os.homedir(), ahora = Date.now() }) {
  const dir = dirSalidas(home);
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (ahora - fs.statSync(p).mtimeMs > DIAS_RETENCION * 864e5) fs.rmSync(p, { force: true });
    }
  } catch {
    // limpieza best effort
  }
  const sello = new Date(ahora).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const limpio = String(id || Math.random().toString(36).slice(2)).replace(/[^\w-]/g, '').slice(-24);
  const ruta = path.join(dir, `${sello}-${limpio}.txt`);
  fs.writeFileSync(ruta, cuerpo);
  return ruta;
}
const RE_CRITICA =
  /\b(error|errors|fail|failed|failure|failing|fatal|panic|exception|traceback|assert(ion)?error|denied|rejected|refused|timeout|timed out)\b|^\s*(E\s{2,}|FAIL\b)|✖|✘|❌/i;
// Líneas que nombran errores pero informan que no hubo ninguno.
const RE_SIN_ERROR = /\b(0|no) (errors?|failures?|failed)\b|\berrors?: 0\b|\bfailed: 0\b/i;

export const esLineaCritica = (l) => RE_CRITICA.test(l) && !RE_SIN_ERROR.test(l);

const firma = (l) => l.replace(/\d+/g, '#').replace(/\b[0-9a-f]{7,}\b/gi, 'h').trim();

/**
 * Colapsa tandas de 3 o más líneas consecutivas con la misma firma (iguales salvo números): `[×N] <primera>` y, si
 * la última es distinta, `[… hasta] <última>`. Una línea crítica nunca se colapsa con otras.
 */
function colapsarRepetidas(lineas) {
  const out = [];
  for (let i = 0; i < lineas.length; ) {
    let j = i + 1;
    const f = firma(lineas[i]);
    const colapsable = f !== '' && !esLineaCritica(lineas[i]);
    while (colapsable && j < lineas.length && firma(lineas[j]) === f) j++;
    const n = j - i;
    if (n >= 3) {
      out.push(`[×${n}] ${lineas[i]}`);
      if (lineas[j - 1] !== lineas[i]) out.push(`[… hasta] ${lineas[j - 1]}`);
    } else out.push(...lineas.slice(i, j));
    i = j;
  }
  return out;
}

/**
 * Compacta texto. Devuelve { texto, antes, despues } (caracteres). Con menos de `maxLineas` líneas tras colapsar
 * repetidas, sólo colapsa. Si no: `cabeza` líneas del principio, `cola` del final y cada línea crítica con
 * `contexto` líneas alrededor; con más de `maxCriticas` críticas, las primeras y las últimas mitades.
 */
export function compactarTexto(texto, { cabeza = 30, cola = 40, contexto = 2, maxCriticas = 60, maxLineas = 150 } = {}) {
  const original = String(texto ?? '');
  const limpio = original.replace(RE_ANSI, '').replace(/\r\n?/g, '\n').trimEnd();
  const crudas = limpio.split('\n');
  if (crudas.length <= maxLineas) return { texto: limpio, antes: original.length, despues: limpio.length };
  const lineas = colapsarRepetidas(crudas);
  if (lineas.length <= maxLineas) {
    const t = lineas.join('\n');
    return { texto: t, antes: original.length, despues: t.length };
  }
  let criticas = [];
  lineas.forEach((l, i) => esLineaCritica(l) && criticas.push(i));
  if (criticas.length > maxCriticas) {
    const mitad = Math.floor(maxCriticas / 2);
    criticas = [...criticas.slice(0, mitad), ...criticas.slice(-mitad)];
  }
  const quedan = new Set();
  for (let i = 0; i < Math.min(cabeza, lineas.length); i++) quedan.add(i);
  for (let i = Math.max(0, lineas.length - cola); i < lineas.length; i++) quedan.add(i);
  for (const c of criticas) for (let i = Math.max(0, c - contexto); i <= Math.min(lineas.length - 1, c + contexto); i++) quedan.add(i);
  const out = [];
  let omitidas = 0;
  for (let i = 0; i < lineas.length; i++) {
    if (quedan.has(i)) {
      if (omitidas) out.push(`[… ${omitidas} líneas omitidas]`);
      omitidas = 0;
      out.push(lineas[i]);
    } else omitidas++;
  }
  if (omitidas) out.push(`[… ${omitidas} líneas omitidas]`);
  const t = out.join('\n');
  return { texto: t, antes: original.length, despues: t.length };
}

const CLAVE_RUIDO = /^(node_id|gravatar_id|_links|performed_via_github_app|reactions|url)$|_url$|^avatar/i;

function limpiarJson(v, opts, prof = 0) {
  if (Array.isArray(v)) {
    const items = v.slice(0, opts.maxItems).map((x) => limpiarJson(x, opts, prof + 1));
    if (v.length > opts.maxItems) items.push({ '…': `${v.length - opts.maxItems} elementos más (ver el original)` });
    return items;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k !== 'html_url' && CLAVE_RUIDO.test(k)) continue;
      out[k] = limpiarJson(x, opts, prof + 1);
    }
    return out;
  }
  if (typeof v === 'string' && v.length > opts.maxTexto) return `${v.slice(0, opts.maxTexto)}… [+${v.length - opts.maxTexto} caracteres]`;
  return v;
}

/** Compacta JSON. null si `texto` no es JSON (objeto o lista). */
export function compactarJson(texto, { maxItems = 20, maxTexto = 400 } = {}) {
  const original = String(texto ?? '');
  const s = original.trim();
  if (!/^[[{]/.test(s)) return null;
  let v;
  try {
    v = JSON.parse(s);
  } catch {
    return null;
  }
  const t = JSON.stringify(limpiarJson(v, { maxItems, maxTexto }));
  return { texto: t, antes: original.length, despues: t.length };
}

/** Compacta según el contenido: { tipo: 'json'|'texto', texto, antes, despues }. */
export function compactar(texto, opciones = {}) {
  const j = compactarJson(texto, opciones);
  return j ? { tipo: 'json', ...j } : { tipo: 'texto', ...compactarTexto(texto, opciones) };
}
