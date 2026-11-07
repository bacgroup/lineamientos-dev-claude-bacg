// Dónde está la transcripción de cada sesión de Claude Code.
//
// Con la cuenta por defecto vive en <home>/.claude/projects/<carpeta>/<id>.jsonl. Con otra cuenta de Claude en la
// misma PC (CLAUDE_CONFIG_DIR) vive en <CLAUDE_CONFIG_DIR>/projects/…. rq.mjs no confía en variables de entorno para
// encontrarla (un agente las cambia con un prefijo en el comando): el hook PreToolUse, que recibe transcript_path de
// Claude Code, la anota en <home real>/.claude/bacg-dev/sesiones/<id>.json, y rq.mjs la busca ahí.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Id de sesión de Claude Code (UUID). Cualquier otra forma se rechaza: el id arma una ruta.
export const RE_SESION = /^[0-9a-f-]{36}$/;

/** Home del usuario del sistema operativo: HOME y USERPROFILE no lo cambian. */
export function homeReal() {
  try {
    return os.userInfo().homedir;
  } catch {
    return os.homedir();
  }
}

/** Carpeta de configuración de Claude Code de la cuenta en uso (plugins, skills): CLAUDE_CONFIG_DIR o ~/.claude. */
export function dirConfigClaude({ env = process.env, home = os.homedir() } = {}) {
  const d = env?.CLAUDE_CONFIG_DIR;
  return typeof d === 'string' && d.trim() ? path.resolve(d) : path.join(home, '.claude');
}

export const dirSesiones = (home = homeReal()) => path.join(home, '.claude', 'bacg-dev', 'sesiones');

const clave = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const dentroDe = (base, p) => {
  const rel = path.relative(clave(base), clave(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** ¿Tiene forma de transcripción de la sesión `id`? …/projects/<carpeta>/<id>.jsonl, ruta absoluta. */
function formaValida(id, ruta) {
  return (
    typeof ruta === 'string' &&
    path.isAbsolute(ruta) &&
    path.basename(ruta) === `${id}.jsonl` &&
    path.basename(path.dirname(path.dirname(ruta))) === 'projects'
  );
}

/**
 * Anota la transcripción de la sesión del hook si no está en el ~/.claude/projects del home real (ahí rq.mjs la
 * encuentra sola). Nunca lanza: un hook no se cae por esto.
 */
export function registrarSesion(entrada, { home = homeReal() } = {}) {
  try {
    const id = entrada?.session_id;
    const ruta = entrada?.transcript_path;
    if (typeof id !== 'string' || !RE_SESION.test(id) || !formaValida(id, ruta)) return false;
    if (dentroDe(path.join(home, '.claude', 'projects'), ruta)) return false;
    const archivo = path.join(dirSesiones(home), `${id}.json`);
    try {
      if (JSON.parse(fs.readFileSync(archivo, 'utf8'))?.transcript === ruta) return false;
    } catch {
      // sin registro todavía
    }
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, `${JSON.stringify({ transcript: ruta })}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Transcripción anotada por el hook para la sesión `id`, si tiene la forma esperada y existe; si no, null. */
export function transcripcionRegistrada(id, { home = homeReal() } = {}) {
  if (typeof id !== 'string' || !RE_SESION.test(id)) return null;
  try {
    const ruta = JSON.parse(fs.readFileSync(path.join(dirSesiones(home), `${id}.json`), 'utf8'))?.transcript;
    return formaValida(id, ruta) && fs.statSync(ruta).isFile() ? ruta : null;
  } catch {
    return null;
  }
}
