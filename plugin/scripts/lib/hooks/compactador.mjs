// PLG-CTX (4.2.0): compactador de salidas para el hook PostToolUse (el equivalente local de un proxy como Headroom).
//
// Una salida de Bash/PowerShell de más de `umbral` caracteres, de un comando que no es lectura de código, diff,
// búsqueda ni rq.mjs, se reemplaza por su versión compactada (lib/compactar.mjs: errores con contexto, principio y
// final; JSON sin campos de ruido). El original completo queda en ~/.claude/bacg-dev/salidas/ y la salida compactada
// dice dónde, para releerlo con Read o grep. Si no se puede guardar el original, o se ahorra poco, no se toca nada.
// Actúa sólo en repos del plugin (o en la carpeta que agrupa los de un proyecto). Se apaga con
// BACG_DEV_SIN_COMPACTAR=1 o con "compactar": false en ~/.claude/bacg-dev.json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarRepo, dirLineamientos } from '../config.mjs';
import { reposDebajo } from '../arranque.mjs';
import { compactar, guardarSalida } from '../compactar.mjs';

const UMBRAL = 4000;
const AHORRO_MINIMO = 0.25;

// Comandos cuya salida se necesita exacta (código, diffs, coincidencias) o que ya acotan la salida.
const EXCLUIDOS = new Set([
  'cat', 'sed', 'head', 'tail', 'nl', 'awk', 'less', 'more', 'type', 'get-content', 'gc', 'grep', 'egrep', 'fgrep', 'rg',
  'findstr', 'select-string', 'sls', 'find', 'ls', 'dir', 'get-childitem', 'gci', 'wc', 'jq', 'diff', 'cmp', 'file', 'stat',
  'tree', 'git-diff',
]);
const GIT_EXACTO = new Set(['diff', 'show', 'log', 'blame', 'grep', 'cat-file', 'format-patch']);

function primeraPalabra(segmento) {
  const tokens = segmento.trim().split(/\s+/).filter(Boolean);
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  while (tokens.length && ['sudo', 'time', 'env', 'command', '&', '.'].includes(tokens[0])) tokens.shift();
  if (!tokens.length) return { palabra: '', resto: [] };
  const palabra = path.basename(tokens[0].replace(/^["']|["']$/g, '')).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
  return { palabra, resto: tokens.slice(1) };
}

/** ¿La salida de este comando se puede compactar? */
export function comandoCompactable(comando) {
  const c = String(comando ?? '');
  if (!c.trim() || /rq\.mjs|\$RQ\b/.test(c)) return false;
  for (const seg of c.split(/&&|\|\||;|\||\r?\n/)) {
    const { palabra, resto } = primeraPalabra(seg);
    if (!palabra || palabra === 'cd' || palabra === 'set-location') continue;
    if (EXCLUIDOS.has(palabra)) return false;
    if (palabra === 'git') {
      // El subcomando es el primer token que no es opción ni el valor de -C, -c, --git-dir, --work-tree.
      let sub = null;
      for (let i = 0; i < resto.length; i++) {
        const t = resto[i];
        if (['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(t)) i++;
        else if (!t.startsWith('-')) {
          sub = t;
          break;
        }
      }
      if (sub && GIT_EXACTO.has(sub.toLowerCase())) return false;
    }
  }
  return true;
}

/** ¿stdout + stderr pasan el umbral? Chequeo barato antes de buscar repos. */
export function salidaLarga(resp, umbral = UMBRAL) {
  if (!resp || typeof resp !== 'object') return false;
  return ['stdout', 'stderr'].reduce((n, k) => n + (typeof resp[k] === 'string' ? resp[k].length : 0), 0) > umbral;
}

function ajustesPc(home) {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, '.claude', 'bacg-dev.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** ¿Compacta en esta carpeta? Repo del plugin o carpeta que agrupa repos de un proyecto, y sin apagarlo. */
export function compactadorActivo(cwd, { env = process.env, home = os.homedir(), dirLin = dirLineamientos() } = {}) {
  if (env?.BACG_DEV_SIN_COMPACTAR === '1') return false;
  if (ajustesPc(home)?.compactar === false) return false;
  if (!cwd) return false;
  if (buscarRepo(cwd, { dirLin })) return true;
  return reposDebajo(cwd, 2, dirLin).length > 0;
}

function guardarOriginal(home, { comando, campos, toolUseId }, ahora) {
  const cuerpo = [`$ ${comando}`, ...Object.entries(campos).map(([k, v]) => `--- ${k} ---\n${v}`)].join('\n');
  return guardarSalida({ cuerpo, id: toolUseId, home, ahora });
}

/**
 * Salida compactada (el objeto tool_response con stdout/stderr reemplazados) o null si no corresponde. No lanza:
 * cualquier problema devuelve null y la salida original pasa tal cual.
 */
export function compactarSalida({ tool, input, resp, toolUseId }, { home = os.homedir(), umbral = UMBRAL, ahora = Date.now() } = {}) {
  try {
    if ((tool !== 'Bash' && tool !== 'PowerShell') || typeof input?.command !== 'string') return null;
    if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return null;
    const campos = Object.fromEntries(['stdout', 'stderr'].filter((k) => typeof resp[k] === 'string').map((k) => [k, resp[k]]));
    const antes = Object.values(campos).reduce((n, v) => n + v.length, 0);
    if (antes <= umbral || !comandoCompactable(input.command)) return null;
    const nuevos = {};
    for (const [k, v] of Object.entries(campos)) nuevos[k] = v.length > umbral / 2 ? compactar(v).texto : v;
    const despues = Object.values(nuevos).reduce((n, v) => n + v.length, 0);
    if (despues > antes * (1 - AHORRO_MINIMO)) return null;
    const ruta = guardarOriginal(home, { comando: input.command, campos, toolUseId }, ahora);
    const aviso = `\n[bacg-dev: salida compactada de ${antes} a ${despues} caracteres (errores con su contexto, principio y final conservados). Original completo: ${ruta} — leelo con Read (offset/limit) o grep si necesitás algo omitido.]`;
    return { ...resp, ...nuevos, stdout: `${nuevos.stdout ?? ''}${aviso}` };
  } catch {
    return null;
  }
}
