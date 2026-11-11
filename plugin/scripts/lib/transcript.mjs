import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

// Envoltorios que inyecta el sistema o la app dentro de mensajes "user" (avisos, eventos de CI y de otras sesiones,
// mensajes de agentes, elementos de una página); una etiqueta sin cerrar se come hasta el final.
const RE_ENVOLTORIOS =
  /<(system-reminder|bash-stdout|bash-stderr|local-command-stdout|ci-monitor-event|side-sessions-event|task-notification|agent-message|launch-selected-element)(?:\s[^>]*)?>[\s\S]*?(?:<\/\1>|$)/gi;
// Avisos del sistema que llegan como mensaje "user" sin marca de origen.
const RE_AVISO_SISTEMA = /^\[Request interrupted by user/;

export function normalizar(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Para comparar: normalizado y con toda puntuación/símbolo reducido a un espacio.
function paraComparar(texto) {
  return normalizar(texto).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Frase corta: menos de 2 palabras o menos de 6 caracteres después de normalizar (o vacía). */
export function fraseCorta(frase) {
  const f = paraComparar(frase ?? '');
  return f === '' || f.split(' ').length < 2 || f.length < 6;
}

/**
 * ¿La frase aparece en algún mensaje tipeado por el usuario? Coincide por palabras completas.
 * Frases cortas (menos de 2 palabras o menos de 6 caracteres) valen sólo si son el mensaje entero.
 * No detecta negaciones ("no está aprobado"): las frases de aprobación deben ser distintivas.
 */
export function fraseDelUsuario(frase, textosUsuario) {
  const f = paraComparar(frase);
  if (!f) return false;
  const corta = fraseCorta(frase);
  return textosUsuario.some((t) => {
    const n = paraComparar(t);
    return corta ? n === f : (' ' + n + ' ').includes(' ' + f + ' ');
  });
}

/** ¿Son la misma frase, sin contar mayúsculas, tildes, puntuación ni espacios? */
export function mismaFrase(a, b) {
  const x = paraComparar(a ?? '');
  return x !== '' && x === paraComparar(b ?? '');
}

/**
 * Cuántas veces dijo el usuario la frase: un mensaje que es la frase entera cuenta una vez; si no, cuenta cada oración
 * entera del mensaje que es la frase ("1. OK\n2. OK" son dos). Oraciones separadas por . ! ? ; salto de
 * línea o " + ", la forma de dar varias decisiones en un mensaje: "Acotado + Aprobar diseño + Ejecutar en línea"; la
 * coma no separa: en "Dale, pero mañana" "Dale" no es una oración). Más estricto que fraseDelUsuario: un tramo
 * suelto de una oración no cuenta.
 */
export function vecesQueLoDijo(frase, textosUsuario) {
  if (paraComparar(frase ?? '') === '') return 0;
  return textosUsuario.reduce(
    (n, t) => n + (mismaFrase(t, frase) ? 1 : String(t).split(/[.!?¡¿;\n]+|\s\+\s/).filter((o) => mismaFrase(o, frase)).length),
    0,
  );
}

// Devuelve el texto tipeado por el humano, o null si la entrada no es suyo.
// Sólo cuenta: type "user", sin isMeta (cuerpos de skills), sin tool_result,
// y origen ausente o humano (los hand-backs de subagentes son origin peer).
function textoHumano(entry) {
  // Un mensaje que el usuario manda mientras el agente trabaja queda como adjunto queued_command (origen humano).
  if (entry?.type === 'attachment') return textoEnCola(entry);
  if (!entry || entry.type !== 'user' || entry.isMeta) return null;
  if (entry.isCompactSummary === true || entry.isSidechain === true) return null;
  if (entry.origin !== undefined && entry.origin?.kind !== 'human') return null;
  const content = entry.message?.content;
  let texto;
  if (typeof content === 'string') {
    texto = content;
  } else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === 'tool_result')) return null;
    texto = content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  } else {
    return null;
  }
  texto = texto.replace(RE_ENVOLTORIOS, '').trim();
  return texto === '' || RE_AVISO_SISTEMA.test(texto) ? null : texto;
}

// Texto de un mensaje en cola tipeado por el humano a mitad de un turno, o null.
function textoEnCola(entry) {
  const a = entry.attachment;
  if (entry.isSidechain === true || a?.type !== 'queued_command' || typeof a.prompt !== 'string') return null;
  if (a.origin?.kind !== 'human' || (a.commandMode !== undefined && a.commandMode !== 'prompt')) return null;
  const texto = a.prompt.replace(RE_ENVOLTORIOS, '').trim();
  return texto === '' || RE_AVISO_SISTEMA.test(texto) ? null : texto;
}

function skillsDe(entry) {
  const out = [];
  if (entry?.type !== 'assistant' || !Array.isArray(entry.message?.content)) return out;
  for (const b of entry.message.content) {
    if (b?.type === 'tool_use' && b.name === 'Skill' && typeof b.input?.skill === 'string') out.push(b.input.skill);
  }
  return out;
}

export async function leerTranscript(ruta, { maxBytes = 50 * 1024 * 1024 } = {}) {
  let size;
  try {
    size = fs.statSync(ruta).size;
  } catch {
    throw new Error('TRANSCRIPT_NO_DISPONIBLE');
  }
  const recortado = size > maxBytes;
  const stream = fs.createReadStream(ruta, recortado ? { start: size - maxBytes } : {});
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const textosUsuario = [];
  const skills = new Set();
  let primera = true;
  try {
    for await (const linea of rl) {
      if (primera) {
        primera = false;
        if (recortado) continue; // línea parcial
      }
      if (!linea.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(linea);
      } catch {
        continue;
      }
      const t = textoHumano(entry);
      if (t !== null) textosUsuario.push(t);
      for (const s of skillsDe(entry)) skills.add(s);
    }
  } catch {
    throw new Error('TRANSCRIPT_NO_DISPONIBLE');
  } finally {
    rl.close();
    stream.destroy();
  }
  return { textosUsuario, skills };
}

// Herramientas cuya entrada nombra un archivo que la sesión leyó o cambió.
const CLAVES_RUTA = ['file_path', 'notebook_path'];
// Carpetas a las que entra un Bash: `cd <dir>` y `git -C <dir>` (con o sin comillas).
const RE_DIR_BASH = /(?:^|[\s;&|(])(?:cd|git\s+-C)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g;

/**
 * Rutas que tocó la sesión según el transcript: archivos de Read/Edit/Write/NotebookEdit y carpetas de los `cd` y
 * `git -C` de Bash/PowerShell (relativas al cwd de esa entrada). Del más reciente al más viejo, sin repetir. Sirve
 * para ubicar el repo cuando la sesión corre fuera de él (por ejemplo, en la carpeta que agrupa varios repos).
 */
export async function rutasTocadas(ruta, { maxBytes = 20 * 1024 * 1024 } = {}) {
  let size;
  try {
    size = fs.statSync(ruta).size;
  } catch {
    return [];
  }
  const recortado = size > maxBytes;
  const stream = fs.createReadStream(ruta, recortado ? { start: size - maxBytes } : {});
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const out = [];
  try {
    for await (const linea of rl) {
      if (!linea.includes('"tool_use"')) continue;
      let entry;
      try {
        entry = JSON.parse(linea);
      } catch {
        continue;
      }
      const base = typeof entry?.cwd === 'string' ? entry.cwd : null;
      for (const b of Array.isArray(entry?.message?.content) ? entry.message.content : []) {
        if (b?.type !== 'tool_use' || !b.input || typeof b.input !== 'object') continue;
        for (const k of CLAVES_RUTA) if (typeof b.input[k] === 'string') out.push(b.input[k]);
        if ((b.name === 'Bash' || b.name === 'PowerShell') && typeof b.input.command === 'string') {
          for (const m of b.input.command.matchAll(RE_DIR_BASH)) {
            const dir = m[1] ?? m[2] ?? m[3];
            if (dir && !dir.startsWith('$') && !dir.startsWith('-')) out.push(base ? path.resolve(base, dir) : dir);
          }
        }
      }
    }
  } catch {
    // transcript ilegible: lo leído hasta acá
  } finally {
    rl.close();
    stream.destroy();
  }
  return [...new Set(out.reverse())];
}
