// PLG-DEPS: lista única de los plugins que el ciclo necesita. Núcleo: todo proyecto. Por stack: sólo si el proyecto los
// usa (PLG-REQ: un proyecto Odoo sin UI web no carga frontend-design ni typescript-lsp). No van en `dependencies` del
// manifiesto (opción C, 19/11/2026): si faltara uno, Claude Code no cargaría este plugin ni sus compuertas de PROD.
// Los exigen el alta (con los comandos para instalarlos) y la compuerta de edición.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pluginsInstalados } from './plugins-instalados.mjs';

export const PLUGINS_NUCLEO = [
  'superpowers@superpowers-marketplace',
  'pr-review-toolkit@claude-plugins-official',
  'security-guidance@claude-plugins-official',
  'claude-security@claude-plugins-official',
  'feature-dev@claude-plugins-official',
  'claude-md-management@claude-plugins-official',
];

const FRONTEND = 'frontend-design@claude-plugins-official';
const TS_LSP = 'typescript-lsp@claude-plugins-official';

/** Núcleo y por stack: los que el plugin puede llegar a pedir (la higiene nunca propone apagarlos). */
export const PLUGINS_TODOS = [...PLUGINS_NUCLEO, FRONTEND, TS_LSP];

function usaTypescript(raiz) {
  if (!raiz) return false;
  if (fs.existsSync(path.join(raiz, 'tsconfig.json'))) return true;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
    return Boolean(pkg?.dependencies?.typescript || pkg?.devDependencies?.typescript);
  } catch {
    return false;
  }
}

/** Requeridos para este repo y proyecto: el núcleo, frontend-design si declara `ui.patrones`, typescript-lsp si usa TS. */
export function pluginsRequeridos({ raiz = null, proyecto = null } = {}) {
  const lista = [...PLUGINS_NUCLEO];
  const patrones = proyecto?.ui?.patrones;
  if (Array.isArray(patrones) && patrones.length > 0) lista.push(FRONTEND);
  if (usaTypescript(raiz)) lista.push(TS_LSP);
  return lista;
}

/** Requeridos que faltan, o null si no se puede leer qué hay instalado (entonces se avisa, nunca se bloquea). */
export function faltantesRequeridos({ raiz = null, proyecto = null, env = process.env, home = os.homedir() } = {}) {
  const instalados = pluginsInstalados({ env, home });
  if (!instalados) return null;
  return pluginsRequeridos({ raiz, proyecto }).filter((p) => !instalados.tiene(p));
}

/** Comandos exactos para instalar los faltantes (el marketplace de superpowers primero, si hace falta). */
export function comandosInstalar(faltan) {
  const cmds = [];
  if (faltan.includes('superpowers@superpowers-marketplace')) cmds.push('claude plugin marketplace add obra/superpowers-marketplace');
  for (const p of faltan) cmds.push(`claude plugin install ${p}`);
  return cmds;
}
