// Locks de archivo entre procesos (rq.mjs, hooks, sesiones en paralelo). El lock es un archivo creado con 'wx'
// (falla si existe) que guarda { pid, fecha, que }. Un lock cuyo proceso ya no existe, o más viejo que `vence`, se
// considera abandonado y se toma.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/** Archivo de lock para un recurso (una ruta), en la carpeta temporal del sistema: fuera de cualquier repo. */
export function lockDe(recurso) {
  const clave = path.resolve(recurso).toLowerCase();
  const h = crypto.createHash('sha1').update(clave).digest('hex').slice(0, 16);
  return path.join(DIR_LOCKS(), `${path.basename(recurso)}-${h}.lock`);
}

/** Lock con nombre (no atado a una ruta), en la misma carpeta. */
export const DIR_LOCKS = () => path.join(os.tmpdir(), 'bacg-dev-locks');
export const lockNombrado = (nombre) => path.join(DIR_LOCKS(), `${nombre}.lock`);

const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** ¿Sigue vivo el proceso? (kill 0 no manda señal: sólo pregunta). EPERM = existe pero es de otro usuario. */
export function procesoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

/** Contenido del lock { pid, fecha, que } si está tomado por un proceso vivo y no vencido; si no, null. */
export function lockTomado(archivo, { vence = Infinity } = {}) {
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    // Recién creado y todavía sin contenido (u otro proceso escribiendo): cuenta como tomado si es nuevo.
    try {
      const edad = Date.now() - fs.statSync(archivo).mtimeMs;
      return edad < 5000 ? { pid: null, fecha: null, que: '?' } : null;
    } catch {
      return null;
    }
  }
  const edad = Date.now() - Date.parse(datos?.fecha ?? '');
  if (!procesoVivo(datos?.pid) || !(edad < vence)) return null;
  return datos;
}

/** Intenta tomar el lock una vez. true si lo tomó. */
export function intentarLock(archivo, que, { vence = Infinity, datos = {} } = {}) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(archivo, 'wx');
      fs.writeSync(fd, JSON.stringify({ ...datos, pid: process.pid, fecha: new Date().toISOString(), que }));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      if (lockTomado(archivo, { vence })) return false;
      // Abandonado: se borra y se reintenta una vez (si otro lo toma en el medio, el 'wx' falla y se respeta).
      fs.rmSync(archivo, { force: true });
    }
  }
  return false;
}

/** Suelta el lock si es de este proceso. */
export function soltarLock(archivo) {
  try {
    const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    if (datos?.pid === process.pid) fs.rmSync(archivo, { force: true });
  } catch {
    // ya no está o es ilegible: nada que soltar
  }
}

/**
 * Corre fn() con el lock tomado, esperando hasta `espera` ms a que se libere. Pensado para secciones cortas (leer y
 * escribir un archivo): un lock más viejo que `vence` ms se toma igual.
 */
export function conLock(archivo, fn, { espera = 10000, vence = 30000, que = 'rq.mjs' } = {}) {
  const limite = Date.now() + espera;
  while (!intentarLock(archivo, que, { vence })) {
    if (Date.now() > limite) throw new Error(`LOCK_OCUPADO: ${archivo}`);
    dormir(25);
  }
  try {
    return fn();
  } finally {
    soltarLock(archivo);
  }
}
