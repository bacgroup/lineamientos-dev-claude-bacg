// PostToolUse: registra en estado.circuito de los RQ activos los pasos de PROD cumplidos (push, merge de PRs
// de sync, SQL) y en estado.skills del RQ en curso las skills cargadas (así los subagentes no tienen que volver a
// cargarlas y las compuertas por etapa saben qué se usó).
// Sólo registra pasos que figuran en circuito_prod del proyecto, y sólo si se ubica el estado del RQ.
// No registra si la respuesta muestra una falla ni un push --dry-run. Los errores no bloquean: se avisan
// en systemMessage.

import fs from 'node:fs';
import path from 'node:path';
import { dirLineamientos, buscarRepo, nombreRepo } from '../config.mjs';
import { guardarEstado, rqActivo, cargarEstado, etapaDerivada } from '../estado.mjs';
import { tieneSkill } from '../requisitos.mjs';
import { operacionesGit, publicaEnProd } from '../compuerta-bash.mjs';
import { entradaSoloLectura } from '../compuerta-mcp.mjs';
import { resolverMcp, cargarRqsDe, proyectoRegistrado, refsProd, norm } from '../contexto.mjs';
import { resumirError } from '../salida.mjs';
import { rutasTocadas } from '../transcript.mjs';
import { espejar } from '../multi-repo.mjs';

const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const lista = (x) => (Array.isArray(x) ? x : []);
const RE_FALLA_PUSH = /\b(error|fatal|rejected|denied)\b/i;
const CODIGOS = ['exitCode', 'exit_code', 'returncode', 'returnCode'];

/** ¿La respuesta de la herramienta muestra una falla? `conPush`: además mira stderr de git push. */
export function respuestaConFalla(resp, conPush = false) {
  if (!esObjeto(resp)) return false;
  if (resp.isError === true || resp.is_error === true || resp.interrupted === true) return true;
  for (const k of CODIGOS) {
    const v = resp[k];
    if (v === undefined || v === null || v === '') continue;
    if (Number(v) !== 0) return true;
  }
  if (resp.error !== undefined && resp.error !== null && resp.error !== false && resp.error !== '') return true;
  return conPush && typeof resp.stderr === 'string' && RE_FALLA_PUSH.test(resp.stderr);
}

/** Agrega el paso (con la grafía de circuito_prod) a cada RQ activo, si es parte del circuito y no estaba. */
function anotar(raiz, proyecto, paso) {
  const oficial = lista(proyecto?.circuito_prod)
    .map((p) => p?.paso)
    .find((p) => typeof p === 'string' && norm(p) === norm(paso));
  if (!oficial) return;
  for (const rq of cargarRqsDe(raiz)) {
    if (!rq.estado) continue;
    const circuito = lista(rq.estado.circuito).filter((c) => !(c?.no_aplica === true && norm(c?.paso) === norm(oficial)));
    if (circuito.some((c) => norm(c?.paso) === norm(oficial))) continue;
    rq.estado.circuito = [...circuito, { paso: oficial, fecha: new Date().toISOString() }];
    guardarEstado(raiz, rq.estado);
  }
}

/** Anota la skill en el RQ en curso del repo (el último de ACTIVO), con la etapa, la sesión y la fecha. */
function anotarSkill(raiz, skill, sesion) {
  const codigo = rqActivo(raiz);
  if (!codigo) return;
  const estado = cargarEstado(raiz, codigo);
  if (tieneSkill(estado, skill)) return;
  const entrada = { skill, etapa: etapaDerivada(estado, raiz), fecha: new Date().toISOString() };
  if (typeof sesion === 'string' && sesion) entrada.sesion = sesion;
  estado.skills = [...lista(estado.skills), entrada];
  guardarEstado(raiz, estado);
  // RQ multi-repo: la skill vale para el RQ lógico, en todos los repos donde está activo.
  const repo = buscarRepo(raiz);
  if (!repo) return;
  let proyecto = null;
  try {
    proyecto = proyectoRegistrado(repo.proyectoId, dirLineamientos(), repo.raiz);
  } catch {
    // proyecto.yml ilegible: igual se replica por carpetas vecinas
  }
  espejar(raiz, repo.proyectoId, proyecto, codigo, (s) => {
    if (tieneSkill(s, skill)) return false;
    s.skills = [...lista(s.skills), { ...entrada }];
  });
}

/**
 * Repos con RQ activo para una sesión que corre fuera de un repo (por ejemplo, en la carpeta que agrupa los repos
 * de un proyecto): los que tocó según el transcript (archivos leídos o editados, cd y git -C) y, si no tocó
 * ninguno todavía, las subcarpetas directas del cwd que son repos.
 */
async function reposDeLaSesion(cwd, transcript) {
  const raices = new Map();
  const sumar = (dir) => {
    const r = buscarRepo(dir);
    if (r && rqActivo(r.raiz)) raices.set(path.resolve(r.raiz).toLowerCase(), r.raiz);
  };
  for (const ruta of typeof transcript === 'string' && transcript ? await rutasTocadas(transcript) : []) {
    sumar(fs.existsSync(ruta) && fs.statSync(ruta).isDirectory() ? ruta : path.dirname(ruta));
  }
  if (raices.size === 0) {
    let hijos = [];
    try {
      hijos = fs.readdirSync(cwd, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'));
    } catch {
      // cwd ilegible
    }
    for (const d of hijos) {
      const dir = path.join(cwd, d.name);
      const r = buscarRepo(dir);
      if (r && path.resolve(r.raiz) === path.resolve(dir)) sumar(dir);
    }
  }
  return [...raices.values()];
}

/**
 * Anota la skill cargada sólo en el RQ en curso (el último de ACTIVO: el que abrió o eligió --rq por última vez).
 * Antes se anotaba en todos los activos y un RQ heredaba skills de otro. Si la sesión corre fuera de un repo, va a
 * los repos que tocó (P5): con un RQ que abarca dos repos, a los dos.
 */
async function registrarSkill(input, cwd, sesion, transcript) {
  const skill = typeof input.skill === 'string' ? input.skill.trim() : '';
  if (!skill) return;
  const repo = buscarRepo(cwd);
  const raices = repo ? [repo.raiz] : await reposDeLaSesion(cwd, transcript);
  for (const raiz of raices) anotarSkill(raiz, skill, sesion);
}

function registrarBash(comando, cwd, resp, dirLin) {
  // Sólo lo que detectó el parser: las ops de la red de seguridad (`red`) bloquean pero no prueban un paso.
  const ops = operacionesGit(comando, cwd).filter((o) => (o.op === 'push' || o.op === 'merge-pr') && !o.red);
  if (ops.length === 0) return;
  if (respuestaConFalla(resp, ops.some((o) => o.op === 'push'))) return;
  for (const op of ops) {
    if (op.dryRun) continue;
    const repo = buscarRepo(op.dir);
    if (!repo) continue;
    const proyecto = proyectoRegistrado(repo.proyectoId, dirLin, repo.raiz);
    if (!proyecto) continue;
    const deGh = op.op === 'merge-pr' && op.repoGh ? String(op.repoGh).split('/').pop().replace(/\.git$/i, '') : '';
    const nombre = deGh || nombreRepo(repo.raiz);
    const entradaRepo = lista(proyecto.repos).find((r) => norm(r?.nombre) === norm(nombre));
    // Con ramas_prod, un push o merge a una rama que no es de PROD (la de DEV) no es un paso del circuito.
    if (entradaRepo && !publicaEnProd(op, repo.raiz, proyecto, entradaRepo)) continue;
    const prefijo = op.op === 'push' ? 'push' : 'merge-prs-sync';
    anotar(repo.raiz, proyecto, `${prefijo}:${entradaRepo ? entradaRepo.nombre : nombre}`);
  }
}

function registrarMcp(tool, input, cwd, resp, dirLin) {
  const n = tool.toLowerCase();
  const escribeSql = n.endsWith('__apply_migration') || (n.endsWith('__execute_sql') && !entradaSoloLectura(input));
  if (!escribeSql || respuestaConFalla(resp)) return;
  const ref = norm(input.project_id);
  if (!ref) return;
  const { proyecto, raiz } = resolverMcp({ cwd, toolInput: input, dirLin });
  if (!proyecto || !raiz || !refsProd(proyecto).includes(ref)) return;
  anotar(raiz, proyecto, `sql:${ref}`);
}

export async function handler(entrada, { dirLin = dirLineamientos() } = {}) {
  try {
    const tool = entrada?.tool_name;
    const input = esObjeto(entrada?.tool_input) ? entrada.tool_input : {};
    const cwd = typeof entrada?.cwd === 'string' && entrada.cwd ? entrada.cwd : process.cwd();
    const resp = entrada?.tool_response;
    if ((tool === 'Bash' || tool === 'PowerShell') && typeof input.command === 'string') registrarBash(input.command, cwd, resp, dirLin);
    else if (tool === 'Skill') await registrarSkill(input, cwd, entrada?.session_id, entrada?.transcript_path);
    else if (typeof tool === 'string' && tool.startsWith('mcp__')) registrarMcp(tool, input, cwd, resp, dirLin);
    return null;
  } catch (e) {
    return { systemMessage: `Aviso: no se pudo registrar el paso del circuito de PROD (${resumirError(e)})` };
  }
}
