// Una sola corrida E2E a la vez por PC y proyecto (handoff 4.0.1, punto 6): dos corridas comparten la app, el
// contenedor y la carpeta de artefactos, y se rompen entre sí (falsos rojos con ENOENT de trazas). `rq.mjs verificar`
// toma el lock mientras corre tests.e2e; la compuerta de Bash niega lanzar ese mismo script E2E a mano mientras el
// lock está tomado, y el comando E2E recibe la ruta del lock en BACG_E2E_LOCK por si el proyecto quiere respetarlo.

import fs from 'node:fs';
import path from 'node:path';
import { DIR_LOCKS, lockNombrado, lockTomado } from './lock.mjs';

const RE_ID = /[^A-Za-z0-9_-]+/g;

/** Archivo del lock E2E de un proyecto en esta PC. */
export const lockE2e = (proyectoId) => lockNombrado(`e2e-${String(proyectoId ?? 'sin-proyecto').replace(RE_ID, '_')}`);

/**
 * Qué identifica al comando E2E dentro de otro comando: el nombre del script (e2e.mjs, run-e2e.sh…) o, si corre
 * Playwright directo, "playwright". null si no hay nada distintivo.
 */
export function firmaE2e(comando) {
  const tokens = String(comando ?? '').split(/[\s"']+/).filter(Boolean);
  const script = tokens.find((t) => /\.(?:[cm]?js|ts|sh|ps1|py)$/i.test(t) && !t.includes('{'));
  if (script) return path.basename(script.replace(/\\/g, '/'));
  if (tokens.some((t) => /^playwright$/i.test(t))) return 'playwright';
  return null;
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ¿El comando ejecuta el script E2E de la firma? (leerlo con cat o grep no cuenta). */
export function ejecutaE2e(comando, firma) {
  if (!firma) return false;
  const texto = String(comando ?? '');
  if (firma === 'playwright') return /\bplaywright\b[^;&|\n]*\btest\b/i.test(texto);
  const f = escapar(firma);
  const conRunner = new RegExp(`\\b(?:node|npx|bun|deno|bash|sh|pwsh|powershell|python3?|tsx)\\b[^;&|\\n]*?(?:^|[\\s"'/\\\\])${f}(?=$|[\\s"';&|])`, 'i');
  const directo = new RegExp(`(?:^|[;&|\\n]\\s*|\\s&\\s*)(?:\\.{0,2}[/\\\\])?(?:[^\\s;&|]*[/\\\\])?${f}(?=$|[\\s;&|])`, 'i');
  return conRunner.test(texto) || directo.test(texto);
}

/** Corridas E2E en curso (locks vivos): [{ archivo, pid, fecha, que, firma, rq }]. */
export function corridasE2e() {
  let nombres = [];
  try {
    nombres = fs.readdirSync(DIR_LOCKS()).filter((n) => /^e2e-.*\.lock$/.test(n));
  } catch {
    return [];
  }
  const out = [];
  for (const n of nombres) {
    const archivo = path.join(DIR_LOCKS(), n);
    const datos = lockTomado(archivo);
    if (datos) out.push({ archivo, ...datos });
  }
  return out;
}

/** La corrida E2E en curso con la que chocaría `comando`, o null. */
export function choqueE2e(comando) {
  return corridasE2e().find((c) => ejecutaE2e(comando, c.firma)) ?? null;
}

export function msgE2eEnCurso(c) {
  const desde = c?.fecha ? new Date(c.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '?';
  return `Hay una corrida E2E en curso${c?.rq ? ` (rq.mjs verificar de ${c.rq}` : ' ('}${c?.pid ? `, pid ${c.pid}` : ''}, desde las ${desde}). Dos E2E a la vez comparten la app y los artefactos y se rompen entre sí: esperá a que termine y corré después.`;
}
