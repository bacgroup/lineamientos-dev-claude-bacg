// UserPromptSubmit: con un RQ activo no dice nada (SessionStart ya dio el contexto). Sin RQ activo, recuerda
// una sola vez por sesión cómo abrir uno; el resto de los mensajes no cargan nada.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarRepo } from '../config.mjs';
import { cargarRqDe } from '../contexto.mjs';
import { contexto } from '../salida.mjs';

const MAX = 300;

function primeraVez(sesion) {
  if (typeof sesion !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sesion)) return true;
  const marca = path.join(os.tmpdir(), `como-trabajo-${sesion}.recordado`);
  if (fs.existsSync(marca)) return false;
  try {
    fs.writeFileSync(marca, '');
  } catch {
    // sin marca: se recuerda de nuevo la próxima vez
  }
  return true;
}

export async function handler(entrada) {
  const cwd = typeof entrada?.cwd === 'string' && entrada.cwd ? entrada.cwd : process.cwd();
  const repo = buscarRepo(cwd);
  if (!repo) return null;
  if (cargarRqDe(repo.raiz)) return null;
  if (!primeraVez(entrada?.session_id)) return null;
  const texto =
    `Proyecto ${repo.proyectoId}, sin RQ activo. Para cambiar código o base: skill como-trabajo-bacg:ciclo-rq. ` +
    'Docs, tests y consultas no necesitan RQ.';
  return contexto('UserPromptSubmit', texto.slice(0, MAX));
}
