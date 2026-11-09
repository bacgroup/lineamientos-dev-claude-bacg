// ¿Está listo el entorno del E2E? (handoff 4.0.1, punto 5: Docker apagado se notaba recién al correr el E2E). El
// arranque lo dice en una línea. Se chequea:
//   - tests.e2e_requisitos: [{ nombre, comando, con_salida? }] del proyecto (o de la PC): el comando tiene que salir 0
//     y, con `con_salida: true`, imprimir algo (p. ej. `docker ps -q -f name=… -f status=running`);
//   - tests.e2e_url: que la app responda (cualquier respuesta HTTP), salvo `e2e_chequear_url: false` (el comando E2E
//     levanta la app él mismo).
// Sin tests.e2e declarado no se chequea nada.

import { spawnSync } from 'node:child_process';
import { comandoE2e } from './cli.mjs';

const lista = (x) => (Array.isArray(x) ? x : []);
const texto = (x) => (typeof x === 'string' ? x.trim() : '');

function urlResponde(url, timeout) {
  const js = `fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(${timeout})}).then(()=>process.exit(0),()=>process.exit(1))`;
  const r = spawnSync(process.execPath, ['-e', js], { timeout: timeout + 2000, stdio: 'ignore' });
  return r.status === 0;
}

function requisitoOk(req, timeout) {
  const r = spawnSync(req.comando, { shell: true, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  if (r.status !== 0) return false;
  return req.con_salida === true ? texto(r.stdout) !== '' : true;
}

/** [{ nombre, ok }] de los requisitos del E2E del proyecto; [] si no declara tests.e2e. */
export function chequearEntornoE2e(proyecto, { timeout = 4000 } = {}) {
  if (!comandoE2e(proyecto)) return [];
  const out = [];
  for (const req of lista(proyecto?.tests?.e2e_requisitos)) {
    if (!texto(req?.comando)) continue;
    out.push({ nombre: texto(req.nombre) || texto(req.comando), ok: requisitoOk(req, timeout) });
  }
  const url = texto(proyecto?.tests?.e2e_url);
  // e2e_chequear_url: false cuando el comando E2E levanta la app él mismo (no tiene que estar arriba de antes).
  if (url && proyecto?.tests?.e2e_chequear_url !== false) out.push({ nombre: `app ${url}`, ok: urlResponde(url, Math.min(timeout, 3000)) });
  return out;
}

/** Una línea para el arranque, o null si no hay nada que chequear. */
export function lineaEntornoE2e(proyecto, opciones) {
  const r = chequearEntornoE2e(proyecto, opciones);
  if (r.length === 0) return null;
  const faltan = r.filter((x) => !x.ok);
  if (faltan.length === 0) return `Entorno E2E listo: ${r.map((x) => x.nombre).join(', ')}.`;
  return `Entorno E2E: ${r.map((x) => `${x.ok ? '✅' : '❌'} ${x.nombre}`).join(', ')}. Levantá lo que falta antes de $RQ verificar (si no, el E2E falla por el entorno, no por el código).`;
}
