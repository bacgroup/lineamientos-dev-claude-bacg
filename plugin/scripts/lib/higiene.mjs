// PLG-CTX (4.2.0): higiene de plugins. Cada plugin habilitado suma a cada sesión el listado de sus skills, comandos y
// agentes (nombre y descripción), lo use o no.
//
// Entre los plugins habilitados en ~/.claude/settings.json distingue:
// - hermanos: los que comparten dos o más skills con este (ciclo-rq, diseno-frontend…), es decir, otra derivación del
//   mismo ciclo con su propia configuración y su propio marcador de repo. Conviven en la misma PC, a veces con otra
//   cuenta de Claude: nunca se proponen apagar; el arranque sólo aclara cuál rige en la carpeta.
// - sin uso: los que no se usaron en las últimas sesiones de esta carpeta (ni una skill, agente, comando ni MCP suyo),
//   si hay sesiones suficientes para juzgarlo. Se proponen apagar sólo en esta carpeta (enabledPlugins en
//   .claude/settings.local.json), sin tocar la configuración global.
// Nunca propone apagar este plugin, un hermano ni los requeridos por el ciclo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirConfigClaude } from './sesiones.mjs';

export const PROPIO = 'lineamientos-dev-claude-bacg@lineamientos-dev-claude-bacg';
const DIR_PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_SESIONES = 30;
const MIN_SESIONES = 5;

const leerJson = (archivo) => {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch {
    return null;
  }
};

const subdirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

function frontmatter(archivo) {
  let texto = '';
  try {
    texto = fs.readFileSync(archivo, 'utf8');
  } catch {
    return null;
  }
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const campo = (k) => m?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
  return { name: campo('name'), description: campo('description') };
}

/** Skills, comandos y agentes de un plugin instalado, y cuánto ocupan en el listado de cada sesión. */
export function componentesPlugin(dir) {
  const skills = [];
  let caracteres = 0;
  for (const d of subdirs(path.join(dir, 'skills')).filter((e) => e.isDirectory())) {
    const fm = frontmatter(path.join(dir, 'skills', d.name, 'SKILL.md'));
    if (!fm) continue;
    skills.push(fm.name || d.name);
    caracteres += (fm.name || d.name).length + fm.description.length + 4;
  }
  let otros = 0;
  for (const tipo of ['commands', 'agents']) {
    for (const f of subdirs(path.join(dir, tipo)).filter((e) => e.isFile() && e.name.endsWith('.md'))) {
      const fm = frontmatter(path.join(dir, tipo, f.name));
      otros++;
      caracteres += f.name.length + (fm?.description.length ?? 0) + 4;
    }
  }
  return { skills, otros, caracteres, tokens: Math.round(caracteres / 4) };
}

/** Carpeta de transcripciones de Claude Code para una carpeta de trabajo. */
export const dirTranscripciones = (cwd, base) => path.join(base, 'projects', path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));

/** De las últimas sesiones de la carpeta, qué plugins (por nombre, sin @marketplace) se usaron. */
export function usoEnSesiones(dir, nombres, max = MAX_SESIONES) {
  const archivos = subdirs(dir)
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => {
      const ruta = path.join(dir, e.name);
      return { ruta, mtime: fs.statSync(ruta).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, max);
  const usados = new Set();
  for (const { ruta } of archivos) {
    let texto = '';
    try {
      texto = fs.readFileSync(ruta, 'utf8');
    } catch {
      continue;
    }
    for (const n of nombres) {
      if (usados.has(n)) continue;
      if ([`"skill":"${n}:`, `"subagent_type":"${n}:`, `mcp__plugin_${n}_`, `/${n}:`].some((s) => texto.includes(s))) usados.add(n);
    }
  }
  return { sesiones: archivos.length, usados };
}

function rutaInstalada(entradas, cwd) {
  const lista = Array.isArray(entradas) ? entradas : [];
  const delProyecto = lista.find((e) => e?.projectPath && path.resolve(e.projectPath).toLowerCase() === path.resolve(cwd).toLowerCase());
  return (delProyecto ?? lista.filter((e) => e?.scope !== 'project').pop() ?? null)?.installPath ?? null;
}

/**
 * Plugins que conviene apagar en esta carpeta y plugins hermanos. Devuelve null si no se pueden leer los plugins
 * instalados; si no, { candidatos: [{ id, tokens }], hermanos: [{ id, compartidas }], sesiones, archivo, tokens }.
 * `soloHermanos`: no mira las transcripciones (para el arranque de sesión, que tiene que ser rápido).
 */
export function higienePlugins({ cwd = process.cwd(), env = process.env, home = os.homedir(), requeridos = [], soloHermanos = false, dirPropio = DIR_PLUGIN } = {}) {
  const base = dirConfigClaude({ env, home });
  const instalados = leerJson(path.join(base, 'plugins', 'installed_plugins.json'))?.plugins;
  if (!instalados || typeof instalados !== 'object') return null;
  const habilitados = { ...(leerJson(path.join(base, 'settings.json'))?.enabledPlugins ?? {}) };
  for (const f of ['settings.json', 'settings.local.json']) Object.assign(habilitados, leerJson(path.join(cwd, '.claude', f))?.enabledPlugins ?? {});
  const propias = new Set(componentesPlugin(dirPropio).skills);
  const evaluar = Object.entries(habilitados)
    .filter(([id, on]) => on === true && id !== PROPIO && !requeridos.includes(id) && instalados[id])
    .map(([id]) => {
      const dir = rutaInstalada(instalados[id], cwd);
      const c = dir ? componentesPlugin(dir) : { skills: [], tokens: 0 };
      return { id, nombre: id.split('@')[0], compartidas: c.skills.filter((s) => propias.has(s)), tokens: c.tokens };
    });
  const hermanos = evaluar.filter((p) => p.compartidas.length >= 2).map((p) => ({ id: p.id, compartidas: p.compartidas }));
  const resto = evaluar.filter((p) => p.compartidas.length < 2);
  let uso = { sesiones: 0, usados: new Set() };
  if (!soloHermanos) uso = usoEnSesiones(dirTranscripciones(cwd, base), resto.map((p) => p.nombre));
  const candidatos = uso.sesiones >= MIN_SESIONES
    ? resto.filter((p) => !uso.usados.has(p.nombre) && p.tokens > 0).map((p) => ({ id: p.id, tokens: p.tokens }))
    : [];
  return {
    candidatos,
    hermanos,
    sesiones: uso.sesiones,
    archivo: path.join(cwd, '.claude', 'settings.local.json'),
    tokens: candidatos.reduce((n, c) => n + c.tokens, 0),
  };
}

/** Descripción corta de un candidato. */
export const textoCandidato = (c, sesiones) => `${c.id}: sin uso en las últimas ${sesiones} sesiones de esta carpeta, ~${c.tokens} tokens por sesión`;

/** Bloque JSON para .claude/settings.local.json que apaga los candidatos. */
export const bloqueApagar = (candidatos) => JSON.stringify({ enabledPlugins: Object.fromEntries(candidatos.map((c) => [c.id, false])) }, null, 2);
