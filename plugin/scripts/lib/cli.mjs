// Ruta absoluta del CLI del RQ (rq.mjs). ${CLAUDE_PLUGIN_ROOT} puede no expandirse en el cuerpo de las skills
// ni en el Bash del agente, así que SessionStart y los motivos de deny la dan resuelta.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactarTexto, guardarSalida } from './compactar.mjs';

/** Primero <CLAUDE_PLUGIN_ROOT>/scripts/rq.mjs si existe; si no, el rq.mjs al lado de esta librería. */
export function rutaCli(pluginRoot = process.env.CLAUDE_PLUGIN_ROOT) {
  if (typeof pluginRoot === 'string' && pluginRoot !== '') {
    const candidata = path.resolve(pluginRoot, 'scripts', 'rq.mjs');
    if (fs.existsSync(candidata)) return candidata;
  }
  return fileURLToPath(new URL('../rq.mjs', import.meta.url));
}

// En los motivos de las compuertas va $RQ: la ruta completa ya la dio SessionStart ("CLI del RQ") y repetirla en
// cada bloqueo sólo suma tokens.
export const cli = () => '$RQ';

/** Capas de tests de proyecto.yml, en el orden en que corren. */
export const ORDEN_TESTS = ['unit', 'componentes', 'sql', 'e2e'];

/**
 * Comandos de tests no vacíos que declara el proyecto, en orden. El E2E no corre en cada commit: lo corre
 * `rq.mjs verificar` una vez por RQ, antes de publicar.
 */
export function comandosTests(proyecto) {
  const defs = proyecto?.tests ?? {};
  return ORDEN_TESTS.filter((k) => k !== 'e2e').map((k) => defs[k]).filter((c) => typeof c === 'string' && c.trim() !== '');
}

// Git Bash en Windows: `bash` a secas puede resolver al de WSL (System32), que no ve las rutas de Windows.
const GIT_BASH = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'];

/**
 * Shell con el que corren los comandos de tests (opción `shell` de spawnSync). Sin `tests.shell`, el del sistema
 * (cmd.exe en Windows): los comandos tienen que ser portables (node, npx; sin && de bash ni $VAR). Con
 * `tests.shell: bash`, Git Bash en Windows; cualquier otro valor es la ruta o el nombre del shell.
 */
export function shellDeTests(proyecto, { platform = process.platform, existe = fs.existsSync } = {}) {
  const s = typeof proyecto?.tests?.shell === 'string' ? proyecto.tests.shell.trim() : '';
  if (!s || s === 'sistema') return true;
  if (s === 'bash' && platform === 'win32') return GIT_BASH.find((r) => existe(r)) ?? 'bash';
  return s;
}

/** Comando E2E del proyecto (tests.e2e), o null si no lo declara. */
export function comandoE2e(proyecto) {
  const c = proyecto?.tests?.e2e;
  return typeof c === 'string' && c.trim() !== '' ? c : null;
}

/** Tests que ya fallan en main (tests.rojos_conocidos): no bloquean al RQ que no los rompió. */
export function rojosConocidos(proyecto) {
  const l = proyecto?.tests?.rojos_conocidos;
  return Array.isArray(l) ? l.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
}

// Códigos de color ANSI (vitest, jest y otros los imprimen aunque la salida no sea una terminal).
const RE_ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Tests que la salida reporta como fallados: líneas "FAIL <archivo> > <caso>" (vitest, jest). Las líneas "× <caso>"
 * del reporte por test no traen el archivo: sólo cuentan si no hay una línea FAIL que ya las nombre (si no, un rojo
 * conocido declarado por archivo no se reconocería).
 */
export function fallosDe(salida) {
  const fail = [];
  const cruz = [];
  for (const l of String(salida ?? '').replace(RE_ANSI, '').split(/\r?\n/)) {
    const m = l.match(/^\s*(FAIL|×|✗)\s+(.+?)\s*$/);
    if (m) (m[1] === 'FAIL' ? fail : cruz).push(m[2].replace(/\s+\d+ms$/, '').trim());
  }
  const sueltos = cruz.filter((c) => !fail.some((f) => f.endsWith(c)));
  return [...new Set([...fail, ...sueltos])];
}

/**
 * ¿Todos los fallos están entre los rojos conocidos? Un fallo es conocido si contiene alguno de los textos
 * declarados. Sin fallos reconocibles en la salida, no (falló algo que no se puede atribuir).
 */
export function soloRojosConocidos(fallos, conocidos) {
  if (fallos.length === 0 || conocidos.length === 0) return false;
  return fallos.every((f) => conocidos.some((c) => f.includes(c)));
}

/**
 * Arma el comando con los archivos en stage: `{archivos}` se reemplaza por las rutas entre comillas dobles.
 * Devuelve null si el comando pide archivos y no hay ninguno (no hay nada relacionado que correr).
 * El comando corre en un shell (sh o cmd), así que una ruta con caracteres que el shell interpreta
 * (`$`, comillas, `%`, `!`, `&`, `|`, `;`, `<`, `>`, `^`, saltos de línea…) lanza: falla cerrada.
 */
const RUTA_SEGURA = /^[\p{L}\p{N} _.\/@+()\[\],=-]+$/u;

export function conArchivos(comando, archivos) {
  if (!comando.includes('{archivos}')) return comando;
  if (archivos.length === 0) return null;
  const insegura = archivos.find((a) => !RUTA_SEGURA.test(a));
  if (insegura !== undefined) {
    throw new Error(`Nombre de archivo que no se puede pasar al shell sin riesgo: ${JSON.stringify(insegura)}. Renombralo o corré los tests a mano.`);
  }
  return comando.replace('{archivos}', () => archivos.map((a) => `"${a}"`).join(' '));
}

/** Pista cuando el proyecto todavía no declara tests. */
export const PISTA_SIN_TESTS =
  'Los tests corren en la PC de cada dev: declaralos en ~/.claude/bacg-dev.json ({"proyectos": {"<id>": {"tests": {"unit": "<comando> {archivos}", "e2e": "<comando> {specs}"}}}}). ' +
  'Si el proyecto todavía no tiene tests, pedile al usuario que autorice `rq.mjs saltar commit "<sus palabras>" "sin tests todavía"`.';

/** Últimas `n` líneas de la salida de un comando, sin códigos ANSI (lo que se muestra cuando algo falla). */
export function cola(salida, n = 60) {
  const l = String(salida ?? '').replace(RE_ANSI, '').trimEnd().split(/\r?\n/);
  return (l.length > n ? [`[… ${l.length - n} líneas antes]`, ...l.slice(-n)] : l).join('\n');
}

/**
 * PLG-CTX: lo que se muestra cuando un test o el E2E falla. Corta, igual que `cola`. Larga: las últimas `n` líneas
 * más cada línea de error de antes con su contexto (el FAIL de Odoo suele salir en el medio, seguido del teardown),
 * y la salida completa guardada en ~/.claude/bacg-dev/salidas/ con la ruta al final.
 */
export function resumenFalla(salida, n = 60, { home = os.homedir(), id = 'falla' } = {}) {
  const texto = String(salida ?? '');
  const l = texto.replace(RE_ANSI, '').trimEnd().split(/\r?\n/);
  if (l.length <= n + 20) return l.join('\n');
  const r = compactarTexto(texto, { cabeza: 5, cola: n, maxLineas: n + 20 });
  try {
    return `${r.texto}\n[salida completa: ${guardarSalida({ cuerpo: texto, id, home })}]`;
  } catch {
    return r.texto;
  }
}

/** Comando E2E con `{specs}` reemplazado por los specs (entre comillas) o, sin specs, por nada: la suite completa. */
export function conSpecs(comando, specs) {
  if (!comando.includes('{specs}')) return comando;
  // Una ruta absoluta de Windows (C:/…) vale: la unidad es lo único con ":".
  const insegura = specs.find((a) => !RUTA_SEGURA.test(String(a).replace(/^[A-Za-z]:(?=\/)/, '')));
  if (insegura !== undefined) throw new Error(`Spec que no se puede pasar al shell sin riesgo: ${JSON.stringify(insegura)}.`);
  return comando.replace('{specs}', () => specs.map((a) => `"${a}"`).join(' ')).replace(/\s+$/, '');
}

/**
 * Rutas portables en los comandos de tests (PLG-NUBE): `{raiz}` es la raíz del repo donde corre el comando y
 * `{repo:<nombre>}` la de otro repo del proyecto en esta máquina (por `ruta_local` o clonado junto a este; ver
 * multi-repo.mjs). Se reemplazan sin comillas: en el comando, ponelas vos ("{repo:powerfy-docker}/qa/x.mjs").
 * `resolver(nombre)` devuelve la raíz o null; un repo que no se encuentra o una ruta con caracteres que el shell
 * interpreta lanzan (falla cerrada).
 */
const RAIZ_SEGURA = /^[\p{L}\p{N} _.\/\\:@+()\[\],=-]+$/u;

export function conRutas(comando, raiz, resolver = () => null) {
  if (typeof comando !== 'string' || !/\{(raiz|repo:[^}]+)\}/.test(comando)) return comando;
  const segura = (r, que) => {
    if (!RAIZ_SEGURA.test(r)) throw new Error(`La ruta de ${que} no se puede pasar al shell sin riesgo: ${JSON.stringify(r)}.`);
    return r.replace(/\\/g, '/');
  };
  return comando
    .replace(/\{raiz\}/g, () => segura(raiz, 'este repo'))
    .replace(/\{repo:([^}]+)\}/g, (_, n) => {
      const r = resolver(n.trim());
      if (!r) throw new Error(`No encuentro el repo ${n.trim()} en esta máquina: clonalo junto a este o declará su ruta_local en proyecto.yml.`);
      return segura(r, n.trim());
    });
}
