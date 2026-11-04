// Contexto compartido por los hooks: RQ activo de un repo y proyecto destino de una herramienta MCP.

import fs from 'node:fs';
import path from 'node:path';
import { buscarRepo, cargarProyecto, carpetaProyecto } from './config.mjs';
import { rqsActivos, cargarEstado } from './estado.mjs';
import { entradaMcpProd } from './mcp-prod.mjs';

const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const lista = (x) => (Array.isArray(x) ? x : []);
export const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : null);

/**
 * proyecto.yml de un proyecto, o null sólo si el archivo no existe (proyecto no registrado).
 * Un YAML inválido o que no es un objeto lanza: la política de falla decide.
 */
export function proyectoRegistrado(id, dirLin, raiz) {
  if (!fs.existsSync(path.join(carpetaProyecto(id, dirLin, raiz), 'proyecto.yml'))) return null;
  const p = cargarProyecto(id, dirLin, raiz);
  if (!esObjeto(p)) throw new Error(`proyecto.yml de ${id} inválido: no es un objeto`);
  return p;
}

/**
 * RQ activos del repo, del más viejo al más reciente: [{ codigo, estado }] (estado null si falta o no parsea).
 */
export function cargarRqsDe(raiz) {
  return rqsActivos(raiz).map((codigo) => {
    try {
      return { codigo, estado: cargarEstado(raiz, codigo) };
    } catch {
      return { codigo, estado: null };
    }
  });
}

/** RQ activo más reciente del repo: { codigo, estado }, o null si no hay ninguno. */
export function cargarRqDe(raiz) {
  const todos = cargarRqsDe(raiz);
  return todos.length ? todos[todos.length - 1] : null;
}

// Refs de Supabase de PROD (los conectores MCP las nombran por project_id). Las bases de otros motores
// (entornos.prod.bases) no pasan por estos conectores: las cubre el circuito.
export const refsProd = (proyecto) => lista(proyecto?.entornos?.prod?.supabase_refs).map(norm).filter(Boolean);

/** ¿El proyecto declara este id como ref de Supabase de PROD o como proyecto de Lovable? */
function contiene(proyecto, id) {
  const lov = esObjeto(proyecto?.lovable?.proyectos) ? Object.values(proyecto.lovable.proyectos).map(norm) : [];
  return refsProd(proyecto).includes(id) || lov.includes(id);
}

/** Todos los proyectos registrados (salvo `_*`). Un proyecto.yml inválido lanza. */
export function proyectosRegistrados(dirLin) {
  let entradas;
  try {
    entradas = fs.readdirSync(path.join(dirLin, 'proyectos'), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entradas) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const proyecto = proyectoRegistrado(e.name, dirLin);
    if (proyecto) out.push({ id: e.name, proyecto });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const mismaRuta = (a, b) => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/**
 * Proyecto y estado para una herramienta MCP.
 * - Proyecto: el del repo de cwd si está registrado; si `project_id` no figura en él, el primer proyecto
 *   registrado que lo declare (ref de PROD o proyecto de Lovable).
 * - Estado: el del repo de cwd si es de ese proyecto; si no, el del repo `rol: padre` con `ruta_local`,
 *   sólo si el .bacg-lineamientos de esa carpeta nombra al mismo proyecto.
 * Devuelve { proyectoId, proyecto, raiz, codigo, estado, rqs } (con null donde no se pudo ubicar; rqs son todos
 * los RQ activos con estado, y codigo/estado el más reciente).
 */
export function resolverMcp({ cwd, toolInput, dirLin, toolName = null }) {
  const repo = buscarRepo(cwd);
  let proyectoId = null;
  let proyecto = null;
  if (repo) {
    proyecto = proyectoRegistrado(repo.proyectoId, dirLin, repo.raiz);
    if (proyecto) proyectoId = repo.proyectoId;
  }
  const ref = norm(esObjeto(toolInput) ? toolInput.project_id : null);
  if (ref && !(proyecto && contiene(proyecto, ref))) {
    const otro = proyectosRegistrados(dirLin).find((x) => contiene(x.proyecto, ref));
    if (otro) ({ id: proyectoId, proyecto } = otro);
  }
  // Servidor MCP de PROD (n8n, Odoo…) que el proyecto de cwd no declara: el primer proyecto que lo declare.
  if (toolName && !(proyecto && entradaMcpProd(proyecto, toolName))) {
    const otro = proyectosRegistrados(dirLin).find((x) => entradaMcpProd(x.proyecto, toolName));
    if (otro) ({ id: proyectoId, proyecto } = otro);
  }
  let raiz = null;
  if (proyecto) {
    if (repo && repo.proyectoId === proyectoId) {
      raiz = repo.raiz;
    } else {
      const padre = lista(proyecto.repos).find(
        (r) => esObjeto(r) && r.rol === 'padre' && typeof r.ruta_local === 'string' && r.ruta_local.trim() !== '',
      );
      const local = padre ? buscarRepo(padre.ruta_local) : null;
      if (local && local.proyectoId === proyectoId && mismaRuta(local.raiz, padre.ruta_local)) raiz = local.raiz;
    }
  }
  const rqs = raiz ? cargarRqsDe(raiz).filter((r) => r.estado) : [];
  const rq = rqs.length ? rqs[rqs.length - 1] : null;
  return { proyectoId, proyecto, raiz, codigo: rq?.codigo ?? null, estado: rq?.estado ?? null, rqs };
}
