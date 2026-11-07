// RQ multi-repo (PLG-MULTI): un RQ con el mismo código activo en varios repos del mismo proyecto es un solo RQ
// lógico. Al abrirlo en un repo más, hereda aprobaciones, autonomía, saltos y skills del primero que lo tenga
// activo; después, cada aprobación, autonomía, salto o skill nueva se replica en los demás.
//
// Repos hermanos: los `ruta_local` de proyecto.repos y las carpetas vecinas (mismo padre) cuya raíz es un repo del
// mismo proyecto, siempre que su nombre (remoto origin o carpeta) figure en proyecto.repos y no sea el del propio repo
// (dos clones o worktrees del mismo repo no se vinculan). Tests, revisión, base y circuito siguen siendo de cada repo: cada uno tiene su diff.

import fs from 'node:fs';
import path from 'node:path';
import { buscarRepo, nombreRepo } from './config.mjs';
import { rqsActivos, cargarEstado, guardarEstado } from './estado.mjs';

const lista = (x) => (Array.isArray(x) ? x : []);
const clave = (p) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/** Raíces de los otros repos del mismo proyecto que hay en esta máquina. */
export function reposHermanos(raiz, proyectoId, proyecto) {
  if (!raiz || !proyectoId) return [];
  const propia = clave(raiz);
  const declarados = new Set(lista(proyecto?.repos).map((r) => String(r?.nombre ?? '').toLowerCase()).filter(Boolean));
  const nombre = (r) => String(nombreRepo(r) ?? path.basename(r)).toLowerCase();
  const propio = nombre(raiz);
  if (!declarados.has(propio)) return [];
  const out = new Map();
  const sumar = (dir) => {
    if (typeof dir !== 'string' || !dir.trim()) return;
    let r;
    try {
      r = buscarRepo(dir);
    } catch {
      return;
    }
    if (!r || r.proyectoId !== proyectoId || clave(r.raiz) !== clave(dir) || clave(r.raiz) === propia) return;
    const n = nombre(r.raiz);
    if (!declarados.has(n) || n === propio) return;
    out.set(clave(r.raiz), r.raiz);
  };
  for (const r of lista(proyecto?.repos)) sumar(r?.ruta_local);
  let vecinos = [];
  try {
    vecinos = fs.readdirSync(path.dirname(raiz), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  } catch {
    // carpeta padre ilegible
  }
  // Sólo una carpeta con .git (carpeta, o archivo en un worktree) puede ser la raíz de un repo: el resto se descarta
  // sin lanzar git, que en una carpeta con miles de vecinos (p. ej. el temp) costaba minutos por comando.
  for (const d of vecinos) {
    const dir = path.join(path.dirname(raiz), d.name);
    if (fs.existsSync(path.join(dir, '.git'))) sumar(dir);
  }
  return [...out.values()];
}

/** Hermanos con el RQ `codigo` activo: [{ raiz, estado }]. */
export function vinculados(raiz, proyectoId, proyecto, codigo) {
  const out = [];
  for (const r of reposHermanos(raiz, proyectoId, proyecto)) {
    if (!rqsActivos(r).includes(codigo)) continue;
    try {
      out.push({ raiz: r, estado: cargarEstado(r, codigo) });
    } catch {
      // estado ilegible o inexistente: ese repo no está vinculado
    }
  }
  return out;
}

/** Aplica `fn(estado)` al RQ en cada repo vinculado y lo guarda. Devuelve los nombres de carpeta tocados. */
export function espejar(raiz, proyectoId, proyecto, codigo, fn) {
  const tocados = [];
  for (const v of vinculados(raiz, proyectoId, proyecto, codigo)) {
    if (fn(v.estado) === false) continue;
    guardarEstado(v.raiz, v.estado);
    tocados.push(path.basename(v.raiz));
  }
  return tocados;
}

const firma = (x) => JSON.stringify(x);
const unir = (a, b) => {
  const vistos = new Set(lista(a).map(firma));
  return [...lista(a), ...lista(b).filter((x) => !vistos.has(firma(x)))];
};

/** Copia al estado nuevo lo compartido del primer repo vinculado. Devuelve el nombre de ese repo o null. */
export function heredar(raiz, proyectoId, proyecto, estado) {
  const [origen] = vinculados(raiz, proyectoId, proyecto, estado.codigo);
  if (!origen) return null;
  const o = origen.estado;
  estado.aprobaciones = unir(estado.aprobaciones, o.aprobaciones);
  estado.saltos = unir(estado.saltos, o.saltos);
  estado.skills = unir(estado.skills, o.skills);
  if (o.clasificacion) {
    estado.clasificacion = o.clasificacion;
    estado.clasificacion_pendiente = o.clasificacion_pendiente === true;
    if (o.clasificacion_confirmada) estado.clasificacion_confirmada = o.clasificacion_confirmada;
  }
  if (!estado.autonomia && o.autonomia) estado.autonomia = o.autonomia;
  if (!estado.ejecucion && o.ejecucion) estado.ejecucion = o.ejecucion;
  if (!estado.tarea && o.tarea) estado.tarea = o.tarea;
  estado.vinculado = [...new Set([...lista(estado.vinculado), path.basename(origen.raiz)])];
  return path.basename(origen.raiz);
}
